"""Compatibility entry point for local development and deployment."""

import threading
import time
import webbrowser

import uvicorn

from app.main import app


def open_browser() -> None:
    time.sleep(1.2)
    webbrowser.open("http://localhost:8000")


if __name__ == "__main__":
    threading.Thread(target=open_browser, daemon=True).start()
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
