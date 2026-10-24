#!/bin/bash
# 一键发布：把最新的 SQL训练系统.html 发布到 GitHub Pages
# 用法：./deploy.sh [HTML文件路径]   （不传参数则只提交仓库里已有的改动）
set -e
cd "$(dirname "$0")"
if [ -n "$1" ]; then
  cp "$1" index.html
fi
git add -A
if git diff --cached --quiet; then
  echo "没有需要发布的改动"
  exit 0
fi
git -c user.name="tsd619124" -c user.email="tsd619124@users.noreply.github.com" commit -m "发布更新 $(date '+%Y-%m-%d %H:%M')" >/dev/null
git push origin main >/dev/null
echo "已推送，约 1 分钟后生效：https://tsd619124.github.io/sql-trainer/"
