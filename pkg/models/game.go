package models

type Game struct {
	ID            string `yaml:"id,omitempty" json:"id"`
	Name          string `yaml:"name" json:"name"`
	PurchasePrice string `yaml:"price" json:"purchase_price"`
	PurchaseDate  string `yaml:"purchase_date" json:"purchase_date"`
	PurchaseWhere string `yaml:"purchace_from" json:"purchase_where"`
	Language      string `yaml:"language" json:"language"`
	URLBGG        string `yaml:"url_bgg" json:"url_bgg"`
	URLLudopedia  string `yaml:"url_ludopedia" json:"url_ludopedia"`
}

type Inventory struct {
	Games []Game `yaml:"games" json:"games"`
}


