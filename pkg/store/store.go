package store

import (
	"os"

	"gopkg.in/yaml.v3"

	"board-games/pkg/models"
)

type Store struct {
    path string
    inv  models.Inventory
}

func New(path string) (*Store, error) {
    b, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }

    // Try list format first
    var inv models.Inventory
    if err := yaml.Unmarshal(b, &inv); err == nil && len(inv.Games) > 0 {
        return &Store{path: path, inv: inv}, nil
    }

    // Fallback: current map-based schema
    var raw struct{ Games map[string]map[string]string `yaml:"games"` }
    if err := yaml.Unmarshal(b, &raw); err != nil {
        return nil, err
    }
    games := make([]models.Game, 0, len(raw.Games))
    for id, v := range raw.Games {
        g := models.Game{
            ID:            id,
            Name:          v["game_name"],
            PurchasePrice: v["price"],
            PurchaseDate:  v["purchase_date"],
            PurchaseWhere: v["store"],
            BGGID:         v["bgg"],
            LudopediaID:   v["ludopedia_id"],
        }
        if v["ludopedia"] == "*" || v["ludopedia_id"] != "" {
            g.LudopediaSyncStatus = models.Synced
        } else {
            g.LudopediaSyncStatus = models.Unsynced
        }
        if v["bgg"] != "" && v["bgg"] != "*" {
            g.BGGSyncStatus = models.Synced
        } else {
            g.BGGSyncStatus = models.Unsynced
        }
        games = append(games, g)
    }
    inv.Games = games
    return &Store{path: path, inv: inv}, nil
}

func (s *Store) List() []models.Game {
    out := make([]models.Game, len(s.inv.Games))
    copy(out, s.inv.Games)
    return out
}

func (s *Store) ReplaceFromYAML(b []byte) error {
    var inv models.Inventory
    if err := yaml.Unmarshal(b, &inv); err == nil && len(inv.Games) > 0 {
        s.inv = inv
        return nil
    }
    var raw struct{ Games map[string]map[string]string `yaml:"games"` }
    if err := yaml.Unmarshal(b, &raw); err != nil {
        return err
    }
    games := make([]models.Game, 0, len(raw.Games))
    for id, v := range raw.Games {
        g := models.Game{
            ID:            id,
            Name:          v["game_name"],
            PurchasePrice: v["price"],
            PurchaseDate:  v["purchase_date"],
            PurchaseWhere: v["store"],
            BGGID:         v["bgg"],
            LudopediaID:   v["ludopedia_id"],
        }
        if v["ludopedia"] == "*" || v["ludopedia_id"] != "" { g.LudopediaSyncStatus = models.Synced } else { g.LudopediaSyncStatus = models.Unsynced }
        if v["bgg"] != "" && v["bgg"] != "*" { g.BGGSyncStatus = models.Synced } else { g.BGGSyncStatus = models.Unsynced }
        games = append(games, g)
    }
    s.inv.Games = games
    return nil
}


