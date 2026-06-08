from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    db_host: str = "db"
    db_port: int = 3306
    db_name: str = "veille"
    db_user: str = "veille"
    db_password: str = "changeme"

    ollama_host: str = "http://localhost:11434"
    ollama_chat_model: str = "llama3.1:8b"
    ollama_embed_model: str = "nomic-embed-text"

    rss_collect_interval: str = "*/30 * * * *"
    arxiv_collect_interval: str = "0 */2 * * *"

    corroboration_window_hours: int = 72
    corroboration_cosine_threshold: float = 0.85
    reliability_threshold: int = 70

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
