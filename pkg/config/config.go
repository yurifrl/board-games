package config

import (
	"os"

	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

type Config struct {
    Port          string `mapstructure:"port"`
    LogLevel      string `mapstructure:"log_level"`
    InventoryPath string `mapstructure:"-"`
    GitHub        GitHub `mapstructure:"github"`
}

type GitHub struct {
    Token            string `mapstructure:"-"`
    Owner            string `mapstructure:"owner"`
    Repo             string `mapstructure:"repo"`
    Path             string `mapstructure:"path"`
    Ref              string `mapstructure:"ref"`
    IntervalSeconds  int    `mapstructure:"interval_seconds"`
}

func Load(cfgFile string) (*viper.Viper, error) {
    v := viper.New()
    if cfgFile != "" {
        v.SetConfigFile(cfgFile)
    } else {
        v.SetConfigName("config")
        v.SetConfigType("yaml")
        v.AddConfigPath(".")
    }
    v.AutomaticEnv()
    _ = v.ReadInConfig()
    return v, nil
}

func Build(cfgFile string, fs *pflag.FlagSet) (*Config, error) {
    v, err := Load(cfgFile)
    if err != nil {
        return nil, err
    }
    if fs != nil {
        _ = v.BindPFlags(fs)
    }
    var c Config
    if err := v.Unmarshal(&c); err != nil {
        return nil, err
    }
    if c.Port == "" {
        c.Port = "8080"
    }
    if c.LogLevel == "" {
        c.LogLevel = "info"
    }
    // InventoryPath has no defaults; set only via flags
    if c.GitHub.Token == "" { c.GitHub.Token = os.Getenv("GHA_PAT") }
    if c.GitHub.Ref == "" { c.GitHub.Ref = "heads/main" }
    if c.GitHub.IntervalSeconds == 0 { c.GitHub.IntervalSeconds = 10 }
    return &c, nil
}


