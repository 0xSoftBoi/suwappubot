"""
Setup script for building the suwappu_core C++ extension.

Build commands:
    pip install -e .                    # Development install
    python setup.py build_ext --inplace # Build in-place
    pip wheel .                         # Build wheel
"""

import os
import sys
import subprocess
from pathlib import Path

from setuptools import setup, Extension, find_packages
from setuptools.command.build_ext import build_ext


class CMakeExtension(Extension):
    """Extension class for CMake-based builds."""
    
    def __init__(self, name, sourcedir=""):
        Extension.__init__(self, name, sources=[])
        self.sourcedir = os.path.abspath(sourcedir)


class CMakeBuild(build_ext):
    """Build extension using CMake."""
    
    def run(self):
        # Check for CMake
        try:
            subprocess.check_output(["cmake", "--version"])
        except OSError:
            raise RuntimeError(
                "CMake must be installed to build the C++ extension. "
                "Install with: brew install cmake (macOS) or apt install cmake (Linux)"
            )
        
        for ext in self.extensions:
            self.build_extension(ext)
    
    def build_extension(self, ext):
        extdir = os.path.abspath(os.path.dirname(self.get_ext_fullpath(ext.name)))
        
        # Required for auto-detection of auxiliary "native" libs
        if not extdir.endswith(os.path.sep):
            extdir += os.path.sep
        
        debug = int(os.environ.get("DEBUG", 0)) if self.debug is None else self.debug
        cfg = "Debug" if debug else "Release"
        
        cmake_args = [
            f"-DCMAKE_LIBRARY_OUTPUT_DIRECTORY={extdir}",
            f"-DPYTHON_EXECUTABLE={sys.executable}",
            f"-DCMAKE_BUILD_TYPE={cfg}",
        ]
        
        build_args = ["--config", cfg]
        
        # Parallel build
        if "CMAKE_BUILD_PARALLEL_LEVEL" not in os.environ:
            # Use all available cores
            import multiprocessing
            build_args += ["-j", str(multiprocessing.cpu_count())]
        
        build_temp = Path(self.build_temp) / ext.name
        build_temp.mkdir(parents=True, exist_ok=True)
        
        # Configure
        subprocess.check_call(
            ["cmake", ext.sourcedir] + cmake_args, cwd=build_temp
        )
        
        # Build
        subprocess.check_call(
            ["cmake", "--build", "."] + build_args, cwd=build_temp
        )


# Read requirements
def read_requirements():
    """Read requirements.txt and return list of dependencies."""
    requirements = []
    req_path = Path(__file__).parent / "requirements.txt"
    
    if req_path.exists():
        with open(req_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("-"):
                    requirements.append(line)
    
    return requirements

# Version logic
def get_version():
    return "1.1.0"


setup(
    name="suwappubot",
    version=get_version(),
    author="Suwappu Team",
    author_email="team@suwappu.com",
    description="Cross-chain swap Telegram bot with C++ high-performance core",
    long_description=open("README.md").read() if os.path.exists("README.md") else "",
    long_description_content_type="text/markdown",
    packages=find_packages(exclude=["tests", "tests.*"]),
    ext_modules=[CMakeExtension("suwappu_core", sourcedir="cpp")],
    cmdclass={"build_ext": CMakeBuild},
    install_requires=read_requirements(),
    extras_require={
        "dev": [
            "pytest>=8.0.0",
            "pytest-asyncio>=0.23.0",
            "pytest-cov>=5.0.0",
        ],
    },
    python_requires=">=3.9",
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: C++",
    ],
    entry_points={
        "console_scripts": [
            "suwappubot=bot.main:main",
        ],
    },
)

