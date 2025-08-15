package ludopedia

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"time"

	"board-games/pkg/httpx"
)

var httpClient = httpx.NewClient(10 * time.Second)

// FetchGameRaw returns the raw JSON payload for a Ludopedia game by slug or id.
func FetchGameRaw(slug string) ([]byte, error) {
    if slug == "" {
        return nil, fmt.Errorf("missing slug")
    }
    appID := os.Getenv("LUDOPEDIA_APP_ID")
    appKey := os.Getenv("LUDOPEDIA_APP_KEY")
    token := os.Getenv("LUDOPEDIA_ACCESS_TOKEN")
    if appID == "" || appKey == "" || token == "" {
        return nil, fmt.Errorf("missing ludopedia credentials")
    }
    u := &url.URL{Scheme: "https", Host: "ludopedia.com.br", Path: "/api/jogos/" + url.PathEscape(slug)}
    q := u.Query()
    q.Set("app_id", appID)
    q.Set("app_key", appKey)
    q.Set("access_token", token)
    u.RawQuery = q.Encode()
    req, _ := httpx.NewRequest("GET", u.String())
    resp, err := httpClient.Do(req)
    if err != nil {
        return nil, fmt.Errorf("request: %w", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode >= 400 {
        return nil, fmt.Errorf("ludopedia http %d", resp.StatusCode)
    }
    b, err := io.ReadAll(resp.Body)
    if err != nil {
        return nil, fmt.Errorf("read body: %w", err)
    }
    // validate it's JSON
    var tmp any
    if err := json.Unmarshal(b, &tmp); err != nil {
        return nil, fmt.Errorf("invalid json: %w", err)
    }
    return b, nil
}

// FetchGame returns a typed Ludopedia Jogo payload by id or slug.
func FetchGame(slug string) (*Jogo, error) {
    b, err := FetchGameRaw(slug)
    if err != nil {
        return nil, err
    }
    var j Jogo
    if err := json.Unmarshal(b, &j); err != nil {
        return nil, fmt.Errorf("decode json: %w", err)
    }
    return &j, nil
}


