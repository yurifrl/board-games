package bgg

import (
	"encoding/xml"
	"fmt"
	"io"
	"time"

	"board-games/pkg/httpx"
)

func FetchThing(id string, includeStats bool) (*ThingItems, error) {
    if id == "" {
        return nil, fmt.Errorf("missing id")
    }
    url := fmt.Sprintf("https://www.boardgamegeek.com/xmlapi2/thing?id=%s", id)
    if includeStats {
        url += "&stats=1"
    }
    req, _ := httpx.NewRequest("GET", url)
    client := httpx.NewClient(10 * time.Second)
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return nil, fmt.Errorf("bgg http %d", resp.StatusCode)
    }
    b, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    var items ThingItems
    if err := xml.Unmarshal(b, &items); err != nil {
        return nil, err
    }
    return &items, nil
}

func FetchThingRaw(id string, includeStats bool) ([]byte, error) {
    if id == "" {
        return nil, fmt.Errorf("missing id")
    }
    url := fmt.Sprintf("https://www.boardgamegeek.com/xmlapi2/thing?id=%s", id)
    if includeStats {
        url += "&stats=1"
    }
    req, _ := httpx.NewRequest("GET", url)
    client := httpx.NewClient(10 * time.Second)
    resp, err := client.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return nil, fmt.Errorf("bgg http %d", resp.StatusCode)
    }
    b, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, err
    }
    return b, nil
}


