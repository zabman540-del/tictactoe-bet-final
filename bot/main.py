"""
main.py (bot)

The entry point for the Telegram bot. This is what actually starts
when you run the bot — it connects to Telegram, loads every handler
file we've built, and starts listening for messages.
"""

import asyncio
import logging
import os

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.redis import RedisStorage

from config import load_settings
from api_client import ApiClient
from handlers import start, play, game, deposit, withdraw, info, challenge, checkers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tictactoe-bot")


MAINT_TEXT = ("🛠️ <b>Nova Bet is under maintenance</b>\n\n"
              "We are adding new games. Please check back soon!")


def _maintenance_on() -> bool:
    return os.getenv("MAINTENANCE", "0").strip().lower() in ("1", "true", "yes", "on")


async def maintenance_mw(handler, event, data):
    """When MAINTENANCE=1 every message/button gets the maintenance notice instead."""
    if not _maintenance_on():
        return await handler(event, data)
    try:
        if getattr(event, "callback_query", None):
            await event.callback_query.answer("🛠️ Under maintenance — new games coming soon!", show_alert=True)
        elif getattr(event, "message", None):
            await event.message.answer(MAINT_TEXT)
    except Exception:
        logger.exception("maintenance reply failed")
    return None


async def main():
    settings = load_settings()

    bot = Bot(
        token=settings.bot_token,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )

    # FSM storage backed by Redis (not memory) so that if the bot
    # restarts, players in the middle of "searching for opponent"
    # or mid-conversation flows (like entering a deposit reference
    # number) don't lose their place.
    storage = RedisStorage.from_url(settings.redis_url)
    dp = Dispatcher(storage=storage)

    api = ApiClient(base_url=settings.api_base_url)

    # Every handler function can request `api` as a parameter (as
    # we've been writing them) — this line is what makes that work,
    # by injecting the same ApiClient instance into every handler call.
    dp["api"] = api
    dp["settings"] = settings

    dp.update.outer_middleware(maintenance_mw)
    dp.include_router(start.router)
    dp.include_router(play.router)
    dp.include_router(challenge.router)
    dp.include_router(game.router)
    dp.include_router(deposit.router)
    dp.include_router(withdraw.router)
    dp.include_router(info.router)

    try:
        from aiogram.types import MenuButtonWebApp, WebAppInfo, BotCommand
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(
            text="Play", web_app=WebAppInfo(url=f"{settings.public_api_base_url}/app-ui/")))
        await bot.set_my_commands([BotCommand(command="start", description="Open Nova Bet")])
    except Exception:
        logger.exception("Could not set the menu button")

    logger.info("Bot starting...")
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
