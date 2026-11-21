import os


class Settings:
    ENV = os.getenv("ENV", "dev")  # dev | test | prod
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-change-me-0123456789abcdef")
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./medcore.db")
    BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", "12"))
    ACCESS_MINUTES = 15
    REFRESH_DAYS = 7
    OTP_MINUTES = 10
    COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    FRONTEND_ORIGINS = [o for o in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000").split(",") if o]
    SUPER_ADMIN_EMAIL = os.getenv("SUPER_ADMIN_EMAIL", "superadmin@medcore-hms.com")
    SUPER_ADMIN_PASSWORD = os.getenv("SUPER_ADMIN_PASSWORD", "ChangeMe123!")


settings = Settings()
