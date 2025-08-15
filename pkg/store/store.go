package store

import (
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"

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
			url_bgg TEXT,
			url_ludopedia TEXT
		);
	`)
	return err
}

func (s *Store) List() []models.Game {
	rows, err := s.db.Query(`SELECT id, name, purchase_price, purchase_date, purchase_where, url_bgg, url_ludopedia FROM games`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := make([]models.Game, 0, 64)
	for rows.Next() {
		var g models.Game
		if err := rows.Scan(&g.ID, &g.Name, &g.PurchasePrice, &g.PurchaseDate, &g.PurchaseWhere, &g.URLBGG, &g.URLLudopedia); err == nil {
			out = append(out, g)
		}
	}
	return out
}

// ReplaceFromYAML loads games from the YAML formats used previously and replaces
// the database contents. This allows feeding the DB from GitHub or files.
func (s *Store) ReplaceFromYAML(b []byte) error {
	var inv models.Inventory
	if err := yaml.Unmarshal(b, &inv); err == nil && len(inv.Games) > 0 {
		return s.replaceAll(inv.Games)
	}
	var raw struct{ Games map[string]map[string]any `yaml:"games"` }
	if err := yaml.Unmarshal(b, &raw); err != nil {
		return err
	}
	games := make([]models.Game, 0, len(raw.Games))
	for id, v := range raw.Games {
		g := models.Game{
			ID:            id,
			Name:          asString(v["game_name"]),
			PurchasePrice: asString(v["price"]),
			PurchaseDate:  asString(v["purchase_date"]),
			PurchaseWhere: asString(v["store"]),
			URLBGG:        asString(v["url_bgg"]),
			URLLudopedia:  asString(v["url_ludopedia"]),
		}
		games = append(games, g)
	}
	return s.replaceAll(games)
}

func (s *Store) replaceAll(games []models.Game) error {
	tx, err := s.db.Begin()
	if err != nil { return err }
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM games`); err != nil { return err }
	stmt, err := tx.Prepare(`INSERT INTO games(id, name, purchase_price, purchase_date, purchase_where, url_bgg, url_ludopedia) VALUES(?,?,?,?,?,?,?)`)
	if err != nil { return err }
	defer stmt.Close()
	for _, g := range games {
		id := g.ID
		if id == "" {
			h := sha1.Sum([]byte(fmt.Sprintf("%s|%s", g.Name, g.PurchaseDate)))
			id = hex.EncodeToString(h[:8])
		}
		if _, err := stmt.Exec(id, g.Name, g.PurchasePrice, g.PurchaseDate, g.PurchaseWhere, g.URLBGG, g.URLLudopedia); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func asString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []any:
		if len(t) == 0 { return "" }
		if s, ok := t[0].(string); ok { return s }
		return ""
	default:
		return ""
	}
}


