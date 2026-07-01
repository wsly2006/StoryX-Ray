# third_party

本目录存放 vendored（源码内嵌）的第三方依赖。不通过 pip 安装，目的是：

- 直接在源码上加日志、改行为，方便诊断耗时和插桩 token 统计
- 锁版本，避免 pip 升级把我们改动覆盖

## langextract

- 上游仓库：https://github.com/google/langextract
- 本地原始路径：`D:/GitHome/fromgithub/langextract/`
- 复制时间：2026-06-30
- 协议：Apache-2.0（见 `langextract/LICENSE`）

由 `app/__init__.py` 把 `third_party/` 加进 `sys.path`，业务代码可以照常
`import langextract as lx`。要恢复用 pip 装的版本：删掉本目录、
requirements.txt 加回 `langextract>=1.0.0`、删除 `app/__init__.py` 里的
`sys.path` 注入。
