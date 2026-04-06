import importlib.util
import os
from types import ModuleType


def load_module(module_name: str, relative_path: str) -> ModuleType:
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    path = os.path.join(root, relative_path)
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
