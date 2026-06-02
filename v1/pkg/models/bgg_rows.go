package models

type BGGThingRow struct {
    GameID        string
    BGGID         int
    Type          string
    PrimaryName   string
    Thumbnail     string
    Image         string
    Description   string
    YearPublished int
    MinPlayers    int
    MaxPlayers    int
    PlayingTime   int
    MinPlayTime   int
    MaxPlayTime   int
    MinAge        int
    UsersRated    int
    Average       float64
    BayesAverage  float64
    StdDev        float64
    Median        float64
    Owned         int
    Trading       int
    Wanting       int
    Wishing       int
    NumComments   int
    NumWeights    int
    AverageWeight float64
    FetchedAt     string
    ExpiresAt     string
}

type BGGNameRow struct {
    GameID    string
    Name      string
    SortIndex int
    Type      string
}

type BGGLinkRow struct {
    GameID  string
    Type    string
    RefID   int
    Value   string
    Inbound string
}

type BGGRankRow struct {
    GameID       string
    Type         string
    RankID       int
    Name         string
    FriendlyName string
    Value        string
    BayesAverage string
}

type BGGPollRow struct {
    GameID    string
    Name      string
    Title     string
    TotalVotes int
}

type BGGPollResultRow struct {
    GameID    string
    PollName  string
    NumPlayers string
    Value     string
    NumVotes  int
    Level     int
}




