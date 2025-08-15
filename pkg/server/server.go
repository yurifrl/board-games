package server

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/log"

	"board-games/pkg/bgg"
	"board-games/pkg/config"
	"board-games/pkg/ludopedia"
	"board-games/pkg/store"
)

type Server struct {
	cfg   *config.Config
	log   *log.Logger
	mux   *http.ServeMux
	tmpl  *template.Template
	store *store.Store
	cacheDir string
}

func New(cfg *config.Config, logger *log.Logger) *Server {
	st, err := store.New(cfg.DBPath)
	if err != nil {
		logger.Warn("failed to open db", "path", cfg.DBPath, "err", err)
		st = store.NewEmpty()
	}
	tmpl := template.Must(template.ParseGlob("templates/*.html"))
	cacheDir := filepath.Join(cfg.CacheDir, "images")
	_ = os.MkdirAll(cacheDir, 0o755)
	s := &Server{cfg: cfg, log: logger, mux: http.NewServeMux(), tmpl: tmpl, store: st, cacheDir: cacheDir}
	s.routes()
	s.startJanitor()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("/", s.handleHome)
	s.mux.HandleFunc("/games", s.handleGames)
	s.mux.HandleFunc("/games/", s.handleGameShow)
	// ID-based image endpoint
	s.mux.HandleFunc("/image/", s.handleImageByID)
	// admin
	s.mux.HandleFunc("/api/load", s.handleLoad)
	// deprecated: remove upstream pass-through endpoints
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tmpl.ExecuteTemplate(w, "index.html", nil); err != nil {
		s.log.Error("template execute failed", "template", "index.html", "err", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
}

func (s *Server) handleGames(w http.ResponseWriter, r *http.Request) {
	games := s.store.List()
	sort.Slice(games, func(i, j int) bool {
		di := parseDate(games[i].PurchaseDate)
		dj := parseDate(games[j].PurchaseDate)
		if di.Equal(dj) { return games[i].Name < games[j].Name }
		return di.After(dj)
	})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := s.tmpl.ExecuteTemplate(w, "games.html", games); err != nil {
		s.log.Error("template execute failed", "template", "games.html", "err", err)
		http.Error(w, "template error", http.StatusInternalServerError)
		return
	}
}

// GET /games/{id}
func (s *Server) handleGameShow(w http.ResponseWriter, r *http.Request) {
    // Expect path like /games/{id}
    parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/games/"), "/")
    if len(parts) == 0 || parts[0] == "" {
        http.NotFound(w, r)
        return
    }
    id := parts[0]
    g, ok := s.store.GetByID(id)
    if !ok {
        http.NotFound(w, r)
        return
    }
    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    if err := s.tmpl.ExecuteTemplate(w, "game.html", g); err != nil {
        s.log.Error("template execute failed", "template", "game.html", "err", err)
        http.Error(w, "template error", http.StatusInternalServerError)
        return
    }
}

func parseDate(s string) time.Time {
	if s == "" { return time.Time{} }
	layouts := []string{"2006-01-02", "02/01/06", "02/01/2006"}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil { return t }
	}
	return time.Time{}
}

func (s *Server) startJanitor() {
	dur, err := time.ParseDuration(s.cfg.CacheTTL)
	if err != nil || dur <= 0 { return }
	ticker := time.NewTicker(dur)
	go func() {
		for range ticker.C {
			_ = filepath.Walk(s.cacheDir, func(path string, info os.FileInfo, err error) error {
				if err != nil || info == nil || info.IsDir() { return nil }
				if time.Since(info.ModTime()) > dur {
					_ = os.Remove(path)
				}
				return nil
			})
			// refresh upstream caches that expired
			s.refreshExpiredCaches()
		}
	}()
}

func (s *Server) refreshExpiredCaches() {
    now := time.Now().Format(time.RFC3339)
    games := s.store.List()
    for _, g := range games {
        if s.store.IsBGGCacheExpired(g.ID, now) {
            if id := extractBGGIDFromURL(g.URLBGG); id != "" {
                if raw, err := bgg.FetchThingRaw(id, true); err == nil {
                    _ = s.store.PutBGGCache(g.ID, id, string(raw), now)
                }
            }
        }
        if s.store.IsLudopediaCacheExpired(g.ID, now) {
            if slug := extractLudopediaSlugFromURL(g.URLLudopedia); slug != "" {
                if b, err := ludopedia.FetchGameRaw(slug); err == nil {
                    _ = s.store.PutLudopediaCache(g.ID, slug, string(b), now)
                }
            }
        }
    }
}

// --- admin load ---

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.log.Warn("method not allowed", "method", r.Method)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	if !s.authorized(r) {
		s.log.Warn("unauthorized")
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}

	var data []byte
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		file, _, err := r.FormFile("file")
		if err != nil {
			s.log.Warn("file required", "err", err)
			http.Error(w, "file required", http.StatusBadRequest)
			return
		}
		defer file.Close()
		b, err := io.ReadAll(file)
		if err != nil {
			s.log.Error("read error", "err", err)
			http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}
		data = b
	} else {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			s.log.Error("read error", "err", err)
			http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			return
		}
		data = b
	}

	if err := s.store.ReplaceFromYAML(data); err != nil {
		s.log.Warn("replace from yaml failed", "err", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	go s.backfillCaches()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "loaded"})
}

func (s *Server) backfillCaches() {
    games := s.store.List()
    for _, g := range games {
        if id := extractBGGIDFromURL(g.URLBGG); id != "" {
            if _, ok := s.store.GetBGGCache(g.ID); !ok {
                if raw, err := bgg.FetchThingRaw(id, true); err == nil {
                    _ = s.store.PutBGGCache(g.ID, id, string(raw), time.Now().Format(time.RFC3339))
                }
            }
        }
        if slug := extractLudopediaSlugFromURL(g.URLLudopedia); slug != "" {
            if _, ok := s.store.GetLudopediaCache(g.ID); !ok {
                if b, err := ludopedia.FetchGameRaw(slug); err == nil {
                    _ = s.store.PutLudopediaCache(g.ID, slug, string(b), time.Now().Format(time.RFC3339))
                }
            }
        }
    }
}

func (s *Server) authorized(r *http.Request) bool {
	req := os.Getenv("BOARDGAMES_TOKEN")
	if req == "" { return true }
	auth := r.Header.Get("Authorization")
	auth = strings.TrimPrefix(auth, "Bearer ")
	if auth == "" { auth = r.URL.Query().Get("token") }
	if auth == "" { auth = r.Header.Get("X-Token") }
	return subtle.ConstantTimeCompare([]byte(req), []byte(auth)) == 1
}

// Image handler and helpers

// GET /image/{id}?source=auto|bgg|ludo&format=thumb|image
func (s *Server) handleImageByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/image/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	source := strings.ToLower(q.Get("source"))
	if source == "" {
		source = "auto"
	}
	format := strings.ToLower(q.Get("format"))
	if format == "" {
		format = "thumb"
	}

	// Try to serve prebuilt file(s) without DB lookups
	serveIfExists := func(name string) bool {
		path := filepath.Join(s.cacheDir, name)
		if f, err := os.Open(path); err == nil {
			defer f.Close()
			sniff := make([]byte, 512)
			n, _ := f.Read(sniff)
			if n > 0 {
				w.Header().Set("Content-Type", http.DetectContentType(sniff[:n]))
				_, _ = f.Seek(0, io.SeekStart)
			}
			http.ServeContent(w, r, name, time.Time{}, f)
			return true
		}
		return false
	}

	candidate := func(src string) string { return id + "_" + src + "_" + format }
	if source == "bgg" && serveIfExists(candidate("bgg")) {
		return
	}
	if source == "ludo" && serveIfExists(candidate("ludo")) {
		return
	}
	if source == "auto" {
		if serveIfExists(candidate("bgg")) {
			return
		}
		if serveIfExists(candidate("ludo")) {
			return
		}
	}

	// Not found locally: kick off background build and return placeholder fast
	go s.buildImageForID(id, source, format)
	http.Redirect(w, r, "https://placehold.co/400x550?text=No+Image", http.StatusFound)
}

func (s *Server) buildImageForID(id, source, format string) {
	g, ok := s.store.GetByID(id)
	if !ok {
		return
	}
	bggID := extractBGGIDFromURL(g.URLBGG)
	ludoSlug := extractLudopediaSlugFromURL(g.URLLudopedia)

	resolve := func(src string) string {
		if src == "bgg" && bggID != "" {
			return fetchBGGImageURLVariant(bggID, format == "image")
		}
		if src == "ludo" && ludoSlug != "" {
			return fetchLudopediaImageURL(ludoSlug)
		}
		return ""
	}
	chosen := ""
	if source == "bgg" || source == "auto" {
		if u := resolve("bgg"); u != "" {
			chosen = "bgg|" + u
		}
	}
	if chosen == "" && (source == "ludo" || source == "auto") {
		if u := resolve("ludo"); u != "" {
			chosen = "ludo|" + u
		}
	}
	if chosen == "" {
		return
	}
	parts := strings.SplitN(chosen, "|", 2)
	src, url := parts[0], parts[1]
	name := id + "_" + src + "_" + format
	path := filepath.Join(s.cacheDir, name)
	_ = downloadToFile(url, path)
}

func fetchBGGImageURL(id string) string {
	items, err := bgg.FetchThing(id, false)
	if err != nil || items == nil || len(items.Item) == 0 { return "" }
	t := items.Item[0]
	if t.Thumbnail != "" { return t.Thumbnail }
	if t.Image != "" { return t.Image }
	return ""
}

func fetchBGGImageURLVariant(id string, wantFull bool) string {
	items, err := bgg.FetchThing(id, false)
	if err != nil || items == nil || len(items.Item) == 0 { return "" }
	t := items.Item[0]
	if wantFull {
		if t.Image != "" { return t.Image }
		if t.Thumbnail != "" { return t.Thumbnail }
		return ""
	}
	if t.Thumbnail != "" { return t.Thumbnail }
	if t.Image != "" { return t.Image }
	return ""
}

func fetchLudopediaImageURL(id string) string {
	url := "https://ludopedia.com.br/jogo/" + id
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "board-games/1.0")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return "" }
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil { return "" }
	re := regexp.MustCompile(`(?i)<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']`)
	m := re.FindSubmatch(b)
	if len(m) == 2 { return string(m[1]) }
	return ""
}

func downloadToFile(url, finalPath string) error {
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "board-games/1.0")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode >= 400 { if resp != nil { resp.Body.Close() }; return fmt.Errorf("fetch error") }
	defer resp.Body.Close()
	tmp := finalPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil { return err }
	if ct := resp.Header.Get("Content-Type"); ct != "" { _ = os.WriteFile(finalPath+".ct", []byte(ct), 0o644) }
	if _, err := io.Copy(f, resp.Body); err != nil { f.Close(); os.Remove(tmp); return err }
	f.Close()
	return os.Rename(tmp, finalPath)
}

func extractBGGIDFromURL(u string) string {
	if u == "" { return "" }
	re := regexp.MustCompile(`/boardgame/(\d+)`)
	m := re.FindStringSubmatch(u)
	if len(m) == 2 { return m[1] }
	return ""
}

func extractLudopediaSlugFromURL(u string) string {
	if u == "" { return "" }
	re := regexp.MustCompile(`/jogo/([^/?#]+)`)
	m := re.FindStringSubmatch(u)
	if len(m) == 2 { return m[1] }
	return ""
}


