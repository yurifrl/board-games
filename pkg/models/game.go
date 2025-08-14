package models

type SyncStatus string

const (
    Synced   SyncStatus = "synced"
    Unsynced SyncStatus = "unsynced"
)

type Game struct {
    ID                  string     `yaml:"id" json:"id"`
    Name                string     `yaml:"name" json:"name"`
    PurchasePrice       string     `yaml:"purchase_price" json:"-"`
    PurchaseDate        string     `yaml:"purchase_date" json:"purchase_date"`
    PurchaseWhere       string     `yaml:"purchase_where" json:"purchase_where"`
    BGGID               string     `yaml:"bgg_id" json:"bgg_id"`
    BGGSyncStatus       SyncStatus `yaml:"bgg_sync_status" json:"bgg_sync_status"`
    LudopediaID         string     `yaml:"ludopedia_id" json:"ludopedia_id"`
    LudopediaSyncStatus SyncStatus `yaml:"ludopedia_sync_status" json:"ludopedia_sync_status"`
}

type Inventory struct {
    Games []Game `yaml:"games" json:"games"`
}


