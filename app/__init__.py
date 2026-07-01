"""StoryX-Ray 后端包。"""
from __future__ import annotations

import sys
from pathlib import Path

# 把 third_party/ 塞到 sys.path 最前面，业务代码可以照常 `import langextract`
# 拿到的是仓库 vendored 的副本而不是 pip 安装的。要切回 pip 版只需删除 third_party/
# langextract/、删掉这段并在 requirements.txt 加回 langextract。
_THIRD_PARTY = Path(__file__).resolve().parent.parent / "third_party"
if str(_THIRD_PARTY) not in sys.path:
    sys.path.insert(0, str(_THIRD_PARTY))

__version__ = "0.1.0"
