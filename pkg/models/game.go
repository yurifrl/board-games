package models

type Game struct {
	ID            string `yaml:"id,omitempty" json:"id"`
	Name          string `yaml:"game_name" json:"name"`
	PurchasePrice string `yaml:"price" json:"purchase_price"`
	PurchaseDate  string `yaml:"purchase_date" json:"purchase_date"`
	PurchaseWhere string `yaml:"store" json:"purchase_where"`
	URLBGG        string `yaml:"url_bgg" json:"url_bgg"`
	URLLudopedia  string `yaml:"url_ludopedia" json:"url_ludopedia"`
}

type Inventory struct {
	Games []Game `yaml:"games" json:"games"`
}


