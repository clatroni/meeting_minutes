"""Open an Outlook draft email pre-filled with the MoM as attachment.

Windows + Outlook desktop only. Gracefully no-ops elsewhere so the rest of
the UI keeps working.

Default behaviour: open the draft in Outlook for review (do NOT send). The
user can edit recipients / body and click Send themselves. Auto-send is
explicitly opt-in via the auto_send=True argument.
"""
from __future__ import annotations

import logging
import platform
from datetime import datetime
from pathlib import Path

log = logging.getLogger("mom.mailer")


def open_outlook_draft(
    attachment: Path,
    *,
    meeting_title: str,
    meeting_date: str = "",
    summary: str = "",
    actions: list[dict] | None = None,
    client_name: str = "",
    to: str = "",
    cc: str = "",
    auto_send: bool = False,
) -> tuple[bool, str]:
    """Open an Outlook draft. Returns (success, message)."""
    if platform.system() != "Windows":
        return False, "Outlook integration requires Windows + Outlook desktop."

    try:
        import pythoncom
        import win32com.client  # type: ignore[import-not-found]
    except ImportError:
        return False, "pywin32 not installed (pip install pywin32)."

    try:
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        mail = outlook.CreateItem(0)  # 0 = MailItem
    except Exception as e:
        return False, f"Could not connect to Outlook: {e}"

    today = meeting_date or datetime.now().strftime("%Y-%m-%d")
    # Subject: prefix with client name when detected, e.g. "Enerwave — Meeting Minutes — Portfolio Sync (2026-05-06)"
    if client_name:
        subject = f"{client_name} — Meeting Minutes — {meeting_title or 'Status Sync'} ({today})"
    else:
        subject = f"Meeting Minutes — {meeting_title or 'Status Sync'} ({today})"

    # Personalised greeting when we know the client
    greeting = f"Hi {client_name} team," if client_name else "Hi all,"
    lines: list[str] = [greeting, ""]
    lines.append(f"Please find attached the minutes of our session on {today}.")
    if summary:
        lines.append("")
        lines.append("Headline:")
        lines.append(f"  {summary}")
    if actions:
        # Show top High-priority actions only — keep email short
        high = [a for a in actions if (a.get("priority") or "").lower() == "high"][:5]
        if high:
            lines.append("")
            lines.append("Immediate next steps:")
            for a in high:
                owner = a.get("owner") or "TBD"
                due = a.get("due_date") or "TBD"
                lines.append(f"  • {a.get('action', '').rstrip('.')} ({owner}, due {due})")
    lines.append("")
    lines.append("Happy to discuss any of the above. Thank you all for the constructive session.")
    lines.append("")
    lines.append("Best regards,")
    lines.append("Christina")
    body = "\n".join(lines)

    try:
        mail.Subject = subject
        if to:
            mail.To = to
        if cc:
            mail.CC = cc
        mail.Body = body
        mail.Attachments.Add(str(attachment.resolve()))
        if auto_send:
            mail.Send()
            return True, f"Email sent: {subject}"
        else:
            mail.Display(True)
            return True, f"Outlook draft opened for review: {subject}"
    except Exception as e:
        return False, f"Could not prepare draft: {e}"
