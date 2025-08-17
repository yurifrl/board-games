package store

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"

	"gopkg.in/yaml.v3"

	"board-games/pkg/models"
)

type Store struct {
	db *sql.DB
}

func New(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "." && dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	if err := initSchema(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func NewEmpty() *Store {
	db, _ := sql.Open("sqlite", ":memory:")
	_ = initSchema(db)
	return &Store{db: db}
}

func initSchema(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS games (
			id TEXT PRIMARY KEY,
			name TEXT,
			purchase_price TEXT,
			purchase_date TEXT,
			purchase_where TEXT,
			language TEXT,
			url_bgg TEXT,
			url_ludopedia TEXT,
			tags TEXT
		);
		CREATE TABLE IF NOT EXISTS bgg_cache (
			game_id TEXT PRIMARY KEY,
			bgg_id TEXT,
			payload TEXT NOT NULL,
			fetched_at TEXT,
			expires_at TEXT
		);
		CREATE TABLE IF NOT EXISTS ludopedia_cache (
			game_id TEXT PRIMARY KEY,
			ludo_slug TEXT,
			payload TEXT NOT NULL,
			fetched_at TEXT,
			expires_at TEXT
		);
		CREATE TABLE IF NOT EXISTS cache_files (
			key TEXT PRIMARY KEY,
			path TEXT NOT NULL,
			mime TEXT,
			size_bytes INTEGER,
			etag TEXT,
			fetched_at TEXT,
			expires_at TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_cache_files_expires ON cache_files(expires_at);
	`)
	if err != nil { return err }
	_, _ = db.Exec(`ALTER TABLE games ADD COLUMN tags TEXT`)
	return nil
}

func (s *Store) List() []models.Game {
	rows, err := s.db.Query(`SELECT id, name, purchase_price, purchase_date, purchase_where, language, url_bgg, url_ludopedia, tags FROM games`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]models.Game, 0, 64)
	for rows.Next() {
		var g models.Game
		var tags string
		if err := rows.Scan(&g.ID, &g.Name, &g.PurchasePrice, &g.PurchaseDate, &g.PurchaseWhere, &g.Language, &g.URLBGG, &g.URLLudopedia, &tags); err == nil {
			if strings.TrimSpace(tags) != "" {
				g.Tags = strings.Split(tags, ",")
				for i := range g.Tags { g.Tags[i] = strings.TrimSpace(g.Tags[i]) }
			}
			out = append(out, g)
		}
	}
	return out
}


func (s *Store) GetByID(id string) (models.Game, bool) {
	row := s.db.QueryRow(`SELECT id, name, purchase_price, purchase_date, purchase_where, language, url_bgg, url_ludopedia, tags FROM games WHERE id = ?`, id)
	var g models.Game
	var tags string
	if err := row.Scan(&g.ID, &g.Name, &g.PurchasePrice, &g.PurchaseDate, &g.PurchaseWhere, &g.Language, &g.URLBGG, &g.URLLudopedia, &tags); err != nil {
		return models.Game{}, false
	}
	if strings.TrimSpace(tags) != "" {
		g.Tags = strings.Split(tags, ",")
		for i := range g.Tags { g.Tags[i] = strings.TrimSpace(g.Tags[i]) }
	}
	return g, true
}

// ReplaceFromYAML loads games from the YAML formats used previously and replaces
// the database contents. This allows feeding the DB from GitHub or files.
func (s *Store) ReplaceFromYAML(b []byte) error {
	var inv models.Inventory
	if err := yaml.Unmarshal(b, &inv); err != nil {
		return err
	}
	if len(inv.Games) == 0 {
		return fmt.Errorf("no games found")
	}
	return s.replaceAll(inv.Games)
}

func (s *Store) replaceAll(games []models.Game) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM games`); err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO games(id, name, purchase_price, purchase_date, purchase_where, language, url_bgg, url_ludopedia, tags) VALUES(?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, g := range games {
		id := g.ID
		if id == "" {
			base := fmt.Sprintf("%s|%s|%s", strings.TrimSpace(g.Name), strings.TrimSpace(g.URLBGG), strings.TrimSpace(g.URLLudopedia))
			if strings.TrimSpace(g.URLBGG) == "" && strings.TrimSpace(g.URLLudopedia) == "" {
				base = fmt.Sprintf("%s|%s", base, strings.TrimSpace(g.PurchaseDate))
			}
			h := sha1.Sum([]byte(base))
			id = hex.EncodeToString(h[:8])
		}
		tags := strings.Join(g.Tags, ",")
		if _, err := stmt.Exec(id, g.Name, g.PurchasePrice, g.PurchaseDate, g.PurchaseWhere, g.Language, g.URLBGG, g.URLLudopedia, tags); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) GetBGGCache(gameID string) (payload string, ok bool) {
	row := s.db.QueryRow(`SELECT payload FROM bgg_cache WHERE game_id = ?`, gameID)
	var p string
	if err := row.Scan(&p); err != nil {
		return "", false
	}
	return p, true
}

func (s *Store) PutBGGCache(gameID, bggID, payload, fetchedAt string) error {
	_, err := s.db.Exec(`INSERT INTO bgg_cache(game_id, bgg_id, payload, fetched_at, expires_at) VALUES(?,?,?,?,datetime('now','+10 days'))
		ON CONFLICT(game_id) DO UPDATE SET bgg_id=excluded.bgg_id, payload=excluded.payload, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`, gameID, bggID, payload, fetchedAt)
	return err
}

func (s *Store) GetLudopediaCache(gameID string) (payload string, ok bool) {
	row := s.db.QueryRow(`SELECT payload FROM ludopedia_cache WHERE game_id = ?`, gameID)
	var p string
	if err := row.Scan(&p); err != nil {
		return "", false
	}
	return p, true
}

func (s *Store) PutLudopediaCache(gameID, slug, payload, fetchedAt string) error {
	_, err := s.db.Exec(`INSERT INTO ludopedia_cache(game_id, ludo_slug, payload, fetched_at, expires_at) VALUES(?,?,?,?,datetime('now','+10 days'))
		ON CONFLICT(game_id) DO UPDATE SET ludo_slug=excluded.ludo_slug, payload=excluded.payload, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at`, gameID, slug, payload, fetchedAt)
	return err
}

func (s *Store) IsBGGCacheExpired(gameID string, now string) bool {
	row := s.db.QueryRow(`SELECT expires_at FROM bgg_cache WHERE game_id = ?`, gameID)
	var ea string
	if err := row.Scan(&ea); err != nil {
		return true
	}
	return ea != "" && ea <= now
}

func (s *Store) IsLudopediaCacheExpired(gameID string, now string) bool {
	row := s.db.QueryRow(`SELECT expires_at FROM ludopedia_cache WHERE game_id = ?`, gameID)
	var ea string
	if err := row.Scan(&ea); err != nil {
		return true
	}
	return ea != "" && ea <= now
}