import os
from pathlib import Path
from typing import Type, cast

from omegaconf import OmegaConf


def load_dotenv(env_file: Path) -> None:
    if not env_file.exists():
        return

    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


def load_config[T](config_file: Path, schema_cls: Type[T]) -> T:
    load_dotenv(config_file.parent / ".env")
    context = OmegaConf.load(config_file)
    schema = OmegaConf.structured(schema_cls)
    return cast(T, OmegaConf.to_object(OmegaConf.merge(schema, context)))
