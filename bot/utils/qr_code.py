"""QR code generation for wallet addresses."""

import io
import qrcode
from qrcode.image.styledpil import StyledPilImage
from qrcode.image.styles.moduledrawers import RoundedModuleDrawer
from qrcode.image.styles.colormasks import SolidFillColorMask
from PIL import Image


def generate_wallet_qr(
    address: str,
    chain: str = None,
    size: int = 300,
) -> bytes:
    """
    Generate a QR code image for a wallet address.
    
    Args:
        address: The wallet address
        chain: Optional chain name for styling
        size: Image size in pixels
        
    Returns:
        PNG image as bytes
    """
    # Create QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    
    # For EVM, can use ethereum: URI scheme
    if chain and chain.lower() in ["ethereum", "polygon", "arbitrum", "optimism", "base", "bsc"]:
        data = f"ethereum:{address}"
    elif chain and chain.lower() == "solana":
        data = f"solana:{address}"
    else:
        data = address
    
    qr.add_data(data)
    qr.make(fit=True)
    
    # Choose colors based on chain
    colors = {
        "ethereum": ("#627EEA", "#1A1A2E"),
        "polygon": ("#8247E5", "#1A1A2E"),
        "arbitrum": ("#28A0F0", "#1A1A2E"),
        "optimism": ("#FF0420", "#1A1A2E"),
        "base": ("#0052FF", "#1A1A2E"),
        "bsc": ("#F0B90B", "#1A1A2E"),
        "solana": ("#14F195", "#1A1A2E"),
    }
    
    fg_color, bg_color = colors.get(chain.lower() if chain else "", ("#000000", "#FFFFFF"))
    
    # Create styled image
    img = qr.make_image(
        image_factory=StyledPilImage,
        module_drawer=RoundedModuleDrawer(),
        color_mask=SolidFillColorMask(
            back_color=hex_to_rgb(bg_color),
            front_color=hex_to_rgb(fg_color),
        ),
    )
    
    # Resize
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Convert to bytes
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    
    return buffer.getvalue()


def generate_simple_qr(address: str, size: int = 300) -> bytes:
    """
    Generate a simple black & white QR code.
    
    Args:
        address: The wallet address
        size: Image size in pixels
        
    Returns:
        PNG image as bytes
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(address)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Resize
    img = img.resize((size, size), Image.Resampling.LANCZOS)
    
    # Convert to bytes
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    
    return buffer.getvalue()


def hex_to_rgb(hex_color: str) -> tuple:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

