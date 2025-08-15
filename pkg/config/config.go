package config

import (
	"strings"

	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

type Config struct {
    Port          string `mapstructure:"port"`
    LogLevel      string `mapstructure:"log_level"`
    DBPath        string `mapstructure:"db_path"`
    CacheDir      string `mapstructure:"cache_path"`
    CacheTTL      string `mapstructure:"cache_ttl"`
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
    v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
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
    if c.DBPath == "" {
        c.DBPath = ".storage/boardgames.db"
    }
    if c.CacheDir == "" {
        c.CacheDir = ".storage/cache"
    }
    if c.CacheTTL == "" {
        c.CacheTTL = "168h"
    }
    return &c, nil
}


