package server

import (
	"crypto/subtle"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html/template"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/log"
	"golang.org/x/image/draw"

	"board-games/pkg/bgg"
	"board-games/pkg/config"
	"board-games/pkg/httpx"
	"board-games/pkg/ludopedia"
	"board-games/pkg/models"
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

// GameDetailData is the payload for the game detail page, enriching the base
// game with BGG and Ludopedia details when available.
type GameDetailData struct {
    models.Game
    BGG  *bgg.Thing
    Ludo *ludopedia.Jogo
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
	s.mux.HandleFunc("/favicon.ico", s.handleFaviconICO)
	s.mux.HandleFunc("/favicon.svg", s.handleFaviconSVG)
	// admin
	s.mux.HandleFunc("/api/load", s.handleLoad)
	// deprecated: remove upstream pass-through endpoints
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// favicon
func (s *Server) handleFaviconICO(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/favicon.svg", http.StatusMovedPermanently)
}

func (s *Server) handleFaviconSVG(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/svg+xml")
	io.WriteString(w, "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='14' font-size='14'>🎲</text></svg>")
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
	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	filtered := games[:0]
	for _, g := range games {
		hasSkip := false
		hasBook := false
		for _, t := range g.Tags {
			v := strings.TrimSpace(t)
			if strings.EqualFold(v, "skip") { hasSkip = true }
			if strings.EqualFold(v, "book") { hasBook = true }
		}
		if hasSkip { continue }
		if scope != "all" && hasBook { continue }
		filtered = append(filtered, g)
	}
	games = filtered
	sort.Slice(games, func(i, j int) bool {
		ti := parseDate(games[i].PurchaseDate)
		tj := parseDate(games[j].PurchaseDate)
		if ti.IsZero() && !tj.IsZero() { return false }
		if !ti.IsZero() && tj.IsZero() { return true }
		if !ti.IsZero() && !tj.IsZero() {
			if !ti.Equal(tj) { return ti.After(tj) }
		}
		if games[i].Name == games[j].Name { return games[i].ID < games[j].ID }
		return games[i].Name < games[j].Name
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
    // Try to enrich with BGG and Ludopedia cached payloads (or fetch on miss)
    var bggThing *bgg.Thing
    if bggID := extractBGGIDFromURL(g.URLBGG); bggID != "" {
        // Prefer cache
        if payload, ok := s.store.GetBGGCache(g.ID); ok {
            var items bgg.ThingItems
            if err := xml.Unmarshal([]byte(payload), &items); err == nil && len(items.Item) > 0 {
                t := items.Item[0]
                bggThing = &t
            }
        } else if raw, err := bgg.FetchThingRaw(bggID, true); err == nil {
            var items bgg.ThingItems
            if err := xml.Unmarshal(raw, &items); err == nil && len(items.Item) > 0 {
                t := items.Item[0]
                bggThing = &t
                _ = s.store.PutBGGCache(g.ID, bggID, string(raw), time.Now().Format(time.RFC3339))
            }
        }
    }

    var ludo *ludopedia.Jogo
    if slug := extractLudopediaSlugFromURL(g.URLLudopedia); slug != "" {
        if payload, ok := s.store.GetLudopediaCache(g.ID); ok {
            var j ludopedia.Jogo
            if err := json.Unmarshal([]byte(payload), &j); err == nil {
                ludo = &j
            }
        } else if raw, err := ludopedia.FetchGameRaw(slug); err == nil {
            var j ludopedia.Jogo
            if err := json.Unmarshal(raw, &j); err == nil {
                ludo = &j
                _ = s.store.PutLudopediaCache(g.ID, slug, string(raw), time.Now().Format(time.RFC3339))
            }
        }
    }

    data := GameDetailData{Game: g, BGG: bggThing, Ludo: ludo}

    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    if err := s.tmpl.ExecuteTemplate(w, "game.html", data); err != nil {
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
	// Optional exact width variant in pixels, e.g., /image/{id}?w=320
	width := 0
	if v := strings.TrimSpace(q.Get("w")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > 1600 { n = 1600 }
			width = n
		}
	}

	// Try to serve prebuilt file(s) without DB lookups
	serveIfExists := func(name string) bool {
		path := filepath.Join(s.cacheDir, name)
		if f, err := os.Open(path); err == nil {
			defer f.Close()
			fi, _ := f.Stat()
			modTime := time.Time{}
			if fi != nil { modTime = fi.ModTime() }
			if b, err := os.ReadFile(path+".ct"); err == nil {
				ct := strings.TrimSpace(string(b))
				if ct != "" { w.Header().Set("Content-Type", ct) }
			} else {
				sniff := make([]byte, 512)
				n, _ := f.Read(sniff)
				if n > 0 {
					w.Header().Set("Content-Type", http.DetectContentType(sniff[:n]))
					_, _ = f.Seek(0, io.SeekStart)
				}
			}
			w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
			http.ServeContent(w, r, name, modTime, f)
			return true
		}
		return false
	}

	candidate := func(src string) string {
		if width > 0 {
			return id + "_" + src + "_w" + strconv.Itoa(width)
		}
		return id + "_" + src + "_" + format
	}
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

	// Not found locally: try to resolve upstream and redirect there immediately
	// while caching in the background so subsequent requests are served locally.
	if g, ok := s.store.GetByID(id); ok {
		bggID := extractBGGIDFromURL(g.URLBGG)
		ludoSlug := extractLudopediaSlugFromURL(g.URLLudopedia)
		upstream := ""
		if (source == "bgg" || source == "auto") && bggID != "" {
			if width > 0 {
				upstream = fetchBGGImageURLVariant(bggID, true)
			} else {
				upstream = fetchBGGImageURLVariant(bggID, format == "image")
			}
		}
		if upstream == "" && (source == "ludo" || source == "auto") && ludoSlug != "" {
			upstream = fetchLudopediaImageURL(ludoSlug)
		}
		if upstream != "" {
			if width > 0 {
				go s.buildWidthVariant(id, source, width)
			} else {
				go s.buildImageForID(id, source, format)
			}
			http.Redirect(w, r, upstream, http.StatusFound)
			return
		}
	}

	// Still nothing: kick off background build and return placeholder fast
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

// buildWidthVariant generates and caches a width-specific JPEG variant from the full image.
func (s *Server) buildWidthVariant(id, source string, width int) {
    baseName := id + "_" + source + "_image"
    basePath := filepath.Join(s.cacheDir, baseName)
    if _, err := os.Stat(basePath); err != nil {
        s.buildImageForID(id, source, "image")
    }
    f, err := os.Open(basePath)
    if err != nil { return }
    img, _, err := image.Decode(f)
    f.Close()
    if err != nil { return }
    b := img.Bounds()
    if b.Dx() <= 0 || b.Dy() <= 0 { return }
    if width > b.Dx() { width = b.Dx() }
    height := int(float64(b.Dy()) * float64(width) / float64(b.Dx()))
    dst := image.NewRGBA(image.Rect(0, 0, width, height))
    draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
    name := id + "_" + source + "_w" + strconv.Itoa(width)
    path := filepath.Join(s.cacheDir, name)
    tmp := path + ".tmp"
    of, err := os.Create(tmp)
    if err != nil { return }
    _ = jpeg.Encode(of, dst, &jpeg.Options{Quality: 85})
    of.Close()
    _ = os.WriteFile(path+".ct", []byte("image/jpeg"), 0o644)
    _ = os.Rename(tmp, path)
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
	req, _ := httpx.NewRequest("GET", url)
	client := httpx.NewClient(5 * time.Second)
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
	req, _ := httpx.NewRequest("GET", url)
	client := httpx.NewClient(10 * time.Second)
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



