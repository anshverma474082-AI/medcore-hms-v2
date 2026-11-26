from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import models
from .config import settings
from .database import Base, engine, SessionLocal
from .responses import ApiError
from .roles import Role
from .routes import auth_routes, hospitals, users, clinical, operations
from .security import hash_password


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        if not db.query(models.User).filter_by(role=Role.SUPER_ADMIN.value).first():
            db.add(models.User(name="Super Admin", email=settings.SUPER_ADMIN_EMAIL.lower(),
                               password_hash=hash_password(settings.SUPER_ADMIN_PASSWORD),
                               role=Role.SUPER_ADMIN.value, email_verified=True))
            db.commit()
    finally:
        db.close()
    yield


app = FastAPI(title="MedCore HMS API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs")
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")
app.add_middleware(CORSMiddleware, allow_origins=settings.FRONTEND_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    if settings.COOKIE_SECURE:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return resp


def err(status, code, message):
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message}})


@app.exception_handler(ApiError)
async def api_error(_, e: ApiError):
    return err(e.status, e.code, e.message)


@app.exception_handler(StarletteHTTPException)
async def http_error(_, e: StarletteHTTPException):
    codes = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED", 401: "UNAUTHORIZED", 403: "FORBIDDEN"}
    return err(e.status_code, codes.get(e.status_code, "ERROR"), str(e.detail))


@app.exception_handler(RequestValidationError)
async def validation_error(_, e: RequestValidationError):
    msg = "; ".join(f"{'.'.join(str(p) for p in x['loc'][1:])}: {x['msg']}" for x in e.errors())
    return err(422, "VALIDATION_ERROR", msg)


for r in (auth_routes, hospitals, users, clinical, operations):
    app.include_router(r.router)


@app.get("/health", tags=["system"])
def health():
    return {"success": True, "data": {"status": "ok"}, "message": "OK"}


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND_DIR / "index.html")
