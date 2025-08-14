package server

import (
	"html/template"
	"net/http"
	"sort"
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
}

func New(cfg *config.Config, logger *log.Logger) *Server {
    st, _ := store.New(cfg.InventoryPath)
    tmpl := template.Must(template.ParseGlob("templates/*.html"))
    s := &Server{cfg: cfg, log: logger, mux: http.NewServeMux(), tmpl: tmpl, store: st}
    s.routes()
    return s
}

func (s *Server) routes() {
    s.mux.HandleFunc("/", s.handleHome)
    s.mux.HandleFunc("/games", s.handleGames)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    s.mux.ServeHTTP(w, r)
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
    _ = s.tmpl.ExecuteTemplate(w, "index.html", nil)
}

func (s *Server) handleGames(w http.ResponseWriter, r *http.Request) {
    games := s.store.List()
    sort.Slice(games, func(i, j int) bool {
        di := parseDate(games[i].PurchaseDate)
        dj := parseDate(games[j].PurchaseDate)
        if di.Equal(dj) { return games[i].ID > games[j].ID }
        return di.After(dj)
    })
    _ = s.tmpl.ExecuteTemplate(w, "games.html", games)
}

func parseDate(s string) time.Time {
    if s == "" { return time.Time{} }
    layouts := []string{"2006-01-02", "02/01/06", "02/01/2006"}
    for _, l := range layouts {
        if t, err := time.Parse(l, s); err == nil { return t }
    }
    return time.Time{}
}


