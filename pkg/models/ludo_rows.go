package models

type LudoJogoRow struct {
    GameID         string
    IDJogo         int
    Nome           string
    ThumbURL       string
    Tipo           string
    Link           string
    AnoPublicacao  int
    AnoNacional    int
    MinJogadores   int
    MaxJogadores   int
    TempoJogoMin   int
    IdadeMinima    int
    QuantidadeTem  int
    QuantidadeTeve int
    QuantidadeFavor int
    QuantidadeQuer int
    QuantidadeJogou int
    FetchedAt      string
    ExpiresAt      string
}

type LudoKVRow struct {
    GameID string
    ID     int
    Name   string
}




