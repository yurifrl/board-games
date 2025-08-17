package bgg

import "encoding/xml"

type ThingItems struct {
    XMLName   xml.Name `xml:"items" json:"-"`
    Termsofuse string  `xml:"termsofuse,attr,omitempty" json:"termsofuse,omitempty"`
    Item      []Thing  `xml:"item" json:"item"`
}

type Thing struct {
    XMLName      xml.Name     `xml:"item" json:"-"`
    Type         string       `xml:"type,attr" json:"type"`
    ID           int          `xml:"id,attr" json:"id"`
    Thumbnail    string       `xml:"thumbnail" json:"thumbnail"`
    Image        string       `xml:"image" json:"image"`
    Name         []Name       `xml:"name" json:"names"`
    Description  string       `xml:"description" json:"description"`
    YearPublished IntValue    `xml:"yearpublished" json:"year_published"`
    MinPlayers   IntValue     `xml:"minplayers" json:"min_players"`
    MaxPlayers   IntValue     `xml:"maxplayers" json:"max_players"`
    PlayingTime  IntValue     `xml:"playingtime" json:"playing_time"`
    MinPlayTime  IntValue     `xml:"minplaytime" json:"min_play_time"`
    MaxPlayTime  IntValue     `xml:"maxplaytime" json:"max_play_time"`
    MinAge       IntValue     `xml:"minage" json:"min_age"`
    Poll         []Poll       `xml:"poll" json:"polls"`
    Link         []Link       `xml:"link" json:"links"`
    Statistics   *Statistics  `xml:"statistics" json:"statistics,omitempty"`
}

type Name struct {
    Type      string `xml:"type,attr" json:"type"`
    ID        int    `xml:"id,attr" json:"id"`
    Value     string `xml:"value,attr" json:"value"`
    SortIndex int    `xml:"sortindex,attr,omitempty" json:"sort_index,omitempty"`
}

type Link struct {
    Type    string `xml:"type,attr" json:"type"`
    ID      int    `xml:"id,attr" json:"id"`
    Value   string `xml:"value,attr" json:"value"`
    Inbound string `xml:"inbound,attr,omitempty" json:"inbound,omitempty"`
}

type IntValue struct { Value int `xml:"value,attr" json:"value"` }
type FloatValue struct { Value float64 `xml:"value,attr" json:"value"` }

type Statistics struct {
    Page    int     `xml:"page,attr" json:"page"`
    Ratings Ratings `xml:"ratings" json:"ratings"`
}

type Ratings struct {
    UsersRated    IntValue    `xml:"usersrated" json:"users_rated"`
    Average       FloatValue  `xml:"average" json:"average"`
    BayesAverage  FloatValue  `xml:"bayesaverage" json:"bayes_average"`
    StdDev        FloatValue  `xml:"stddev" json:"std_dev"`
    Median        FloatValue  `xml:"median" json:"median"`
    Owned         IntValue    `xml:"owned" json:"owned"`
    Trading       IntValue    `xml:"trading" json:"trading"`
    Wanting       IntValue    `xml:"wanting" json:"wanting"`
    Wishing       IntValue    `xml:"wishing" json:"wishing"`
    NumComments   IntValue    `xml:"numcomments" json:"num_comments"`
    NumWeights    IntValue    `xml:"numweights" json:"num_weights"`
    AverageWeight FloatValue  `xml:"averageweight" json:"average_weight"`
    Ranks         []Rank      `xml:"ranks>rank" json:"ranks"`
}

type Rank struct {
    Type         string `xml:"type,attr" json:"type"`
    ID           int    `xml:"id,attr" json:"id"`
    Name         string `xml:"name,attr" json:"name"`
    FriendlyName string `xml:"friendlyname,attr" json:"friendly_name"`
    Value        string `xml:"value,attr" json:"value"`
    BayesAverage string `xml:"bayesaverage,attr,omitempty" json:"bayes_average,omitempty"`
}

type Poll struct {
    Name       string        `xml:"name,attr" json:"name"`
    Title      string        `xml:"title,attr" json:"title"`
    TotalVotes int           `xml:"totalvotes,attr" json:"total_votes"`
    Results    []PollResults `xml:"results" json:"results"`
}

type PollResults struct {
    NumPlayers string       `xml:"numplayers,attr" json:"num_players"`
    Result     []PollResult `xml:"result" json:"result"`
}

type PollResult struct {
    Value    string `xml:"value,attr" json:"value"`
    NumVotes int    `xml:"numvotes,attr" json:"num_votes"`
    Level    int    `xml:"level,attr,omitempty" json:"level,omitempty"`
}






