package httpx

import (
	"net/http"
	"time"
)

const UserAgent = "board-games/1.0"

func NewClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func NewRequest(method, url string) (*http.Request, error) {
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", UserAgent)
	return req, nil
}


