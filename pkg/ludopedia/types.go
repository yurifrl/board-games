package ludopedia

type Jogo struct {
    IDJogo           int               `json:"id_jogo"`
    Nome             string            `json:"nm_jogo"`
    ThumbURL         string            `json:"thumb"`
    Tipo             string            `json:"tp_jogo"`
    Link             string            `json:"link"`
    AnoPublicacao    int               `json:"ano_publicacao"`
    AnoNacional      int               `json:"ano_nacional"`
    MinJogadores     int               `json:"qt_jogadores_min"`
    MaxJogadores     int               `json:"qt_jogadores_max"`
    TempoJogoMin     int               `json:"vl_tempo_jogo"`
    IdadeMinima      int               `json:"idade_minima"`
    QuantidadeTem    int               `json:"qt_tem"`
    QuantidadeTeve   int               `json:"qt_teve"`
    QuantidadeFavor  int               `json:"qt_favorito"`
    QuantidadeQuer   int               `json:"qt_quer"`
    QuantidadeJogou  int               `json:"qt_jogou"`
    Mecanicas        []JogoMecanica    `json:"mecanicas"`
    Categorias       []JogoCategoria   `json:"categorias"`
    Temas            []JogoTema        `json:"temas"`
    Artistas         []JogoProfissional`json:"artistas"`
    Designers        []JogoProfissional`json:"designers"`
}

type JogoResumo struct {
    IDJogo      int    `json:"id_jogo"`
    Nome        string `json:"nm_jogo"`
    NomeOriginal string `json:"nm_original"`
    ThumbURL    string `json:"thumb"`
    Link        string `json:"link"`
}

type JogoMecanica struct {
    IDMecanica int    `json:"id_mecanica"`
    Nome       string `json:"nm_mecanica"`
}

type JogoCategoria struct {
    IDCategoria int    `json:"id_categoria"`
    Nome        string `json:"nm_categoria"`
}

type JogoTema struct {
    IDTema int    `json:"id_tema"`
    Nome   string `json:"nm_tema"`
}

type JogoProfissional struct {
    IDProfissional int    `json:"id_profissional"`
    Nome           string `json:"nm_profissional"`
}


