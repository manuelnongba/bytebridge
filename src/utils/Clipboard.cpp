#include "Clipboard.h"

#include <QClipboard>
#include <QGuiApplication>

namespace ByteBridge {

bool Clipboard::copy(const QString &text)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard) {
        clipboard->setText(text);
        return true;
    }
    return false;
}

QString Clipboard::paste()
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard) {
        return clipboard->text();
    }
    return QString();
}

bool Clipboard::hasText()
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard) {
        return !clipboard->text().isEmpty();
    }
    return false;
}

void Clipboard::clear()
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    if (clipboard) {
        clipboard->clear();
    }
}

} // namespace ByteBridge
