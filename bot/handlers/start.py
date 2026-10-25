"""
handlers/start.py

Handles /start. Unlike before, this no longer registers the user
silently using only their Telegram info — it now asks for their
NAME and PHONE NUMBER first, since that's how the platform
identifies real people (per your decision: name + phone, no KYC/age
checks for now).

Flow:
  1. /start -> if already registered, just show the menu
  2. If new -> ask for full name
  3. Ask for phone number
  4. Register via the backend API, then show the menu
"""

from aiogram import Router, F
from aiogram.filters import CommandStart, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, ReplyKeyboardRemove, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

from states import RegistrationStates
from keyboards import main_menu_keyboard, open_app_keyboard

router = Router()


def _app_kb(settings, payload: str | None = None) -> InlineKeyboardMarkup:
    url = f"{settings.public_api_base_url}/app-ui/"
    text = "🎰 Play Nova Bet"
    if payload and payload.startswith("rps_"):
        url += f"#/rps/{payload[4:]}"
        text = "⚔️ Open challenge"
    elif payload and payload.startswith("duel_"):
        url += f"#/duel/{payload[5:]}"
        text = "⚔️ Open challenge"
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=text, web_app=WebAppInfo(url=url))]])


@router.message(CommandStart())
async def cmd_start(message: Message, command: CommandObject, state: FSMContext, settings):
    """The bot is just the front door: everything (sign-up, wallet, games) lives in the app."""
    await state.clear()
    await message.answer(
        "🎰 <b>NOVA BET</b>\nCasino games and 1v1 matches with real players.",
        reply_markup=ReplyKeyboardRemove(),
    )
    await message.answer("Tap below to open the app 👇", reply_markup=_app_kb(settings, command.args))


@router.message(RegistrationStates.entering_name)
async def name_entered(message: Message, state: FSMContext):
    name = message.text.strip() if message.text else ""
    if len(name) < 2:
        await message.answer("⚠️ Please enter your full name.")
        return

    await state.update_data(full_name=name)
    await message.answer("📱 Now enter your phone number (e.g. 09xxxxxxxx):")
    await state.set_state(RegistrationStates.entering_phone)


@router.message(RegistrationStates.entering_phone)
async def phone_entered(message: Message, state: FSMContext, api, settings):
    phone = message.text.strip() if message.text else ""
    if len(phone) < 9:
        await message.answer("⚠️ Please enter a valid phone number.")
        return

    data = await state.get_data()

    try:
        await api.register_user(
            telegram_user_id=message.from_user.id,
            username=message.from_user.username,
            full_name=data["full_name"],
            phone_number=phone,
        )
    except Exception:
        await message.answer(
            "⚠️ This phone number is already registered to another account. "
            "Please enter a different phone number, or contact support via ❓ Help."
        )
        return

    await state.clear()
    await message.answer(
        "✅ Account created!\n\n"
        "📌 How it works:\n"
        "• Both players stake the same amount\n"
        "• Winner takes the pot minus a small platform fee (1–3 ETB)\n"
        "• A draw = full refund to both players, no fee\n\n"
        "Tap below to open Nova Bet — wallet, games, friends, everything is in there.",
        reply_markup=open_app_keyboard(settings.public_api_base_url),
    )
