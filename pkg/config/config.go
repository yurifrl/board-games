package config

import (
	"github.com/spf13/pflag"
	"github.com/spf13/viper"
)

type Config struct {
    Port          string `mapstructure:"port"`
    LogLevel      string `mapstructure:"log_level"`
    DBPath        string `mapstructure:"db_path"`
    CacheDir      string `mapstructure:"cache_path"`
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
    if c.DBPath == "" { c.DBPath = "./data/boardgames.db" }
    if c.CacheDir == "" { c.CacheDir = "./data/cache" }
    return &c, nil
}


