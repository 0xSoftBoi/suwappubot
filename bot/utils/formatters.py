"""Message and data formatting utilities."""

from typing import Optional
from bot.config.chains import CHAINS, get_chain_by_name


def format_amount(amount: float, decimals: int = 2, symbol: str = "") -> str:
    """
    Format an amount with thousands separators and optional symbol.
    
    Args:
        amount: The amount to format
        decimals: Number of decimal places
        symbol: Token symbol to append
        
    Returns:
        Formatted amount string (e.g., "1,234.56 USDT")
    """
    if amount >= 1_000_000:
        formatted = f"{amount:,.{decimals}f}"
    elif amount >= 1:
        formatted = f"{amount:,.{decimals}f}"
    else:
        # Show more decimals for small amounts
        formatted = f"{amount:.6f}".rstrip('0').rstrip('.')
    
    if symbol:
        return f"{formatted} {symbol}"
    return formatted


def format_usd(amount: float) -> str:
    """
    Format an amount as USD.
    
    Args:
        amount: Amount in USD
        
    Returns:
        Formatted USD string (e.g., "$1,234.56")
    """
    return f"${amount:,.2f}"


def format_tx_link(tx_hash: str, chain_name: str) -> str:
    """
    Create a clickable transaction link for Telegram.
    
    Args:
        tx_hash: Transaction hash
        chain_name: Name of the chain
        
    Returns:
        Markdown formatted link
    """
    chain = get_chain_by_name(chain_name)
    if not chain:
        return tx_hash
    
    if chain.chain_type.value == "solana":
        url = f"{chain.explorer_url}/tx/{tx_hash}"
    else:
        url = f"{chain.explorer_url}/tx/{tx_hash}"
    
    short_hash = f"{tx_hash[:8]}...{tx_hash[-6:]}"
    return f"[{short_hash}]({url})"


def format_address_link(address: str, chain_name: str) -> str:
    """
    Create a clickable address link for Telegram.
    
    Args:
        address: Wallet address
        chain_name: Name of the chain
        
    Returns:
        Markdown formatted link
    """
    chain = get_chain_by_name(chain_name)
    if not chain:
        return address
    
    if chain.chain_type.value == "solana":
        url = f"{chain.explorer_url}/account/{address}"
    else:
        url = f"{chain.explorer_url}/address/{address}"
    
    short_address = f"{address[:6]}...{address[-4:]}"
    return f"[{short_address}]({url})"


def format_chain_name(chain_name: str) -> str:
    """
    Get display name for a chain.
    
    Args:
        chain_name: Internal chain name
        
    Returns:
        Display name with emoji
    """
    chain = get_chain_by_name(chain_name)
    if chain:
        return f"{chain.logo_emoji} {chain.display_name}"
    return chain_name


def format_swap_summary(
    from_chain: str,
    from_token: str,
    from_amount: float,
    to_chain: str,
    to_token: str,
    to_amount: float,
    gas_fee: Optional[float] = None,
    bridge_fee: Optional[float] = None,
) -> str:
    """
    Format a swap summary for display.
    
    Returns:
        Formatted swap summary string
    """
    from_chain_display = format_chain_name(from_chain)
    to_chain_display = format_chain_name(to_chain)
    
    lines = [
        "📊 *Swap Summary*",
        "",
        f"*From:* {format_amount(from_amount, symbol=from_token)}",
        f"*Chain:* {from_chain_display}",
        "",
        f"*To:* {format_amount(to_amount, symbol=to_token)}",
        f"*Chain:* {to_chain_display}",
    ]
    
    if gas_fee is not None or bridge_fee is not None:
        lines.append("")
        lines.append("*Fees:*")
        if gas_fee is not None:
            lines.append(f"  • Gas: {format_usd(gas_fee)}")
        if bridge_fee is not None:
            lines.append(f"  • Bridge: {format_usd(bridge_fee)}")
    
    return "\n".join(lines)


def format_balance_list(balances: dict[str, dict[str, float]]) -> str:
    """
    Format a multi-chain balance list.
    
    Args:
        balances: Dict of chain_name -> {token_symbol: amount}
        
    Returns:
        Formatted balance string
    """
    if not balances:
        return "No balances found."
    
    lines = ["💰 *Your Balances*", ""]
    
    for chain_name, tokens in balances.items():
        chain_display = format_chain_name(chain_name)
        lines.append(f"*{chain_display}*")
        
        for symbol, amount in tokens.items():
            if amount > 0:
                lines.append(f"  • {format_amount(amount, symbol=symbol)}")
        
        lines.append("")
    
    return "\n".join(lines)


def format_time_estimate(seconds: int) -> str:
    """
    Format estimated time in human-readable format.
    
    Args:
        seconds: Time in seconds
        
    Returns:
        Human readable time (e.g., "~2 min", "~30 sec")
    """
    if seconds < 60:
        return f"~{seconds} sec"
    elif seconds < 3600:
        minutes = seconds // 60
        return f"~{minutes} min"
    else:
        hours = seconds // 3600
        return f"~{hours} hr"

