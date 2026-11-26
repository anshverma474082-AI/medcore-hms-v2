from fastapi import HTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def ok(data=None, message="OK", meta=None):
    body = {"success": True, "data": data, "message": message}
    if meta:
        body["meta"] = meta
    return body


def page_meta(page, limit, total):
    return {"page": page, "limit": limit, "total": total, "totalPages": max(1, -(-total // limit))}
