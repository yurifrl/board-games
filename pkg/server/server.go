package server

import (
	"crypto/sha1"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"html/template"
	"io"
	"net/http"
	urlpkg "net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/log"

	"board-games/pkg/config"
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
	s.mux.HandleFunc("/image", s.handleImage)
	s.mux.HandleFunc("/proxy", s.handleProxyImage)
	// admin
	s.mux.HandleFunc("/api/load", s.handleLoad)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
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
	if err := s.tmpl.ExecuteTemplate(w, "games.html", games); err != nil {
		s.log.Error("template execute failed", "template", "games.html", "err", err)
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
		}
	}()
}

// --- admin load ---

func (s *Server) handleLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "method not allowed", http.StatusMethodNotAllowed); return }
	if !s.authorized(r) { http.Error(w, "unauthorized", http.StatusUnauthorized); return }

	var data []byte
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		file, _, err := r.FormFile("file")
		if err != nil { http.Error(w, "file required", http.StatusBadRequest); return }
		defer file.Close()
		b, err := io.ReadAll(file)
		if err != nil { http.Error(w, "read error", http.StatusInternalServerError); return }
		data = b
	} else {
		b, err := io.ReadAll(r.Body)
		if err != nil { http.Error(w, "read error", http.StatusInternalServerError); return }
		data = b
	}

	if err := s.store.ReplaceFromYAML(data); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "loaded"})
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

func (s *Server) handleImage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	bggURL := q.Get("bgg_url")
	ludoURL := q.Get("ludo_url")
	if id := extractBGGIDFromURL(bggURL); id != "" {
		if u := fetchBGGImageURL(id); u != "" {
			http.Redirect(w, r, "/proxy?url="+urlpkg.QueryEscape(u), http.StatusFound)
			return
		}
	}
	if slug := extractLudopediaSlugFromURL(ludoURL); slug != "" {
		if u := fetchLudopediaImageURL(slug); u != "" {
			http.Redirect(w, r, "/proxy?url="+urlpkg.QueryEscape(u), http.StatusFound)
			return
		}
	}
	http.Redirect(w, r, "https://placehold.co/400x550?text=No+Image", http.StatusFound)
}

// handleProxyImage downloads remote images and caches them on disk.
// Query params: url=REMOTE_URL
func (s *Server) handleProxyImage(w http.ResponseWriter, r *http.Request) {
	url := r.URL.Query().Get("url")
	if url == "" {
		http.Error(w, "missing url", http.StatusBadRequest)
		return
	}

	// Hash file name for cache key
	h := sha1.Sum([]byte(url))
	name := hex.EncodeToString(h[:])
	path := filepath.Join(s.cacheDir, name)

	// Serve from cache if exists
	if f, err := os.Open(path); err == nil {
		defer f.Close()
		// Detect content type from file bytes
		sniff := make([]byte, 512)
		n, _ := f.Read(sniff)
		if n > 0 {
			w.Header().Set("Content-Type", http.DetectContentType(sniff[:n]))
			_, _ = f.Seek(0, io.SeekStart)
		}
		http.ServeContent(w, r, name, time.Time{}, f)
		return
	}

	// Fetch and store
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "board-games/1.0")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil || resp.StatusCode >= 400 {
		http.Redirect(w, r, "https://placehold.co/400x550?text=No+Image", http.StatusFound)
		return
	}
	defer resp.Body.Close()
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil { http.Error(w, "cache error", http.StatusInternalServerError); return }
	if ct := resp.Header.Get("Content-Type"); ct != "" { w.Header().Set("Content-Type", ct) }
	if _, err := io.Copy(f, resp.Body); err != nil { f.Close(); os.Remove(tmp); http.Error(w, "cache write", http.StatusInternalServerError); return }
	f.Close()
	_ = os.Rename(tmp, path)

	// Re-open stable file to serve
	rf, err := os.Open(path)
	if err != nil { http.Redirect(w, r, "https://placehold.co/400x550?text=No+Image", http.StatusFound); return }
	defer rf.Close()
	if w.Header().Get("Content-Type") == "" {
		sniff := make([]byte, 512)
		n, _ := rf.Read(sniff)
		if n > 0 { w.Header().Set("Content-Type", http.DetectContentType(sniff[:n])); _, _ = rf.Seek(0, io.SeekStart) }
	}
	http.ServeContent(w, r, name, time.Time{}, rf)
}

type bggItemsResp struct {
	XMLName xml.Name  `xml:"items"`
	Item    []bggItem `xml:"item"`
}

type bggItem struct {
	Image     string `xml:"image"`
	Thumbnail string `xml:"thumbnail"`
}

func fetchBGGImageURL(id string) string {
	url := "https://www.boardgamegeek.com/xmlapi2/thing?id=" + id
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "board-games/1.0")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil { return "" }
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil { return "" }
	var data bggItemsResp
	if err := xml.Unmarshal(b, &data); err != nil { return "" }
	if len(data.Item) == 0 { return "" }
	if data.Item[0].Image != "" { return data.Item[0].Image }
	if data.Item[0].Thumbnail != "" { return data.Item[0].Thumbnail }
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


