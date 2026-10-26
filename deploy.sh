#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
case "${1:---check}" in
  --check) publish=false ;;
  --publish) publish=true ;;
  *) echo "用法：./deploy.sh --check（本地完整验收）或 ./deploy.sh --publish（验收后提交并推送）" >&2; exit 2 ;;
esac
python3 scripts/verify-release.py
if [ "$publish" = false ]; then exit 0; fi
if [ "$(git branch --show-current)" != main ]; then echo "请在 main 分支确认发布内容。" >&2; exit 1; fi
remote_url=$(git remote get-url origin)
case "$remote_url" in
  https://github.com/tsd619124/sql-trainer.git|git@github.com:tsd619124/sql-trainer.git) ;;
  *) echo "origin 与 SQL 训练系统发布仓库不一致，已停止。" >&2; exit 1 ;;
esac
while IFS= read -r staged; do
  case "$staged" in
    index.html|sw.js|manifest.webmanifest|release.json|icons/*|scripts/*|tests/*|deploy.sh|README.md|.gitignore) ;;
    *) echo "存在发布范围外的暂存文件，请先处理：$staged" >&2; exit 1 ;;
  esac
done < <(git diff --cached --name-only)
git add -- index.html sw.js manifest.webmanifest release.json icons scripts tests deploy.sh README.md .gitignore
if git diff --cached --quiet; then
  echo "没有需要发布的改动"
  exit 0
fi
git commit -m "发布 SQL Lab $(node -p 'require("./release.json").version')"
git push origin main
echo "已推送，请按 README 的线上清单验收：https://tsd619124.github.io/sql-trainer/"
