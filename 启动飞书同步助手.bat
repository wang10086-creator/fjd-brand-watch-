@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 bridge\assistant.py
) else (
  python bridge\assistant.py
)
if errorlevel 1 (
  echo.
  echo 请确认已安装 Python 3.10 或更高版本。无需安装任何 pip 依赖。
  echo 官方下载：https://www.python.org/downloads/windows/
  echo 如果提示端口被占用，请先关闭此前启动的助手窗口。
  pause
)
