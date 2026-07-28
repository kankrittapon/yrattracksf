from app.config import Settings


def test_cors_origins_accepts_comma_separated_env_value(monkeypatch) -> None:
    monkeypatch.setenv(
        "CORS_ORIGINS",
        "https://dashboard.example.com, https://preview.example.com",
    )

    settings = Settings(_env_file=None)

    assert settings.cors_origins == [
        "https://dashboard.example.com",
        "https://preview.example.com",
    ]
