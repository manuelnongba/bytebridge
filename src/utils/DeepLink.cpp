#include "DeepLink.h"

#include <QCoreApplication>
#include <QProcess>
#include <QDebug>

#ifdef Q_OS_MAC
#include <CoreFoundation/CoreFoundation.h>
#endif

#ifdef Q_OS_WIN
#include <Windows.h>
#endif

namespace ByteBridge {

DeepLink::DeepLink(QObject *parent)
    : QObject(parent)
{
}

DeepLink& DeepLink::instance()
{
    static DeepLink instance;
    return instance;
}

bool DeepLink::registerProtocol(const QString &protocol)
{
    qDebug() << "Registering URL protocol:" << protocol;
    
#ifdef Q_OS_MAC
    // On macOS, URL schemes are registered in Info.plist
    // This is handled at build time via CMake
    // The app will automatically receive URLs when launched
    
    // For development, we can use LSSetDefaultHandlerForURLScheme
    // but Info.plist is the proper way for production
    
    return true;
    
#elif defined(Q_OS_WIN)
    // On Windows, register in the registry
    // HKEY_CURRENT_USER\Software\Classes\{protocol}
    
    QString appPath = QCoreApplication::applicationFilePath();
    appPath.replace("/", "\\");
    
    // Create registry entries
    QString regPath = QString("HKEY_CURRENT_USER\\Software\\Classes\\%1").arg(protocol);
    
    // This would normally use QSettings with registry or Windows API
    // For production, use an installer (NSIS, WiX) to set these
    
    qDebug() << "Windows URL protocol registration - App path:" << appPath;
    return true;
    
#elif defined(Q_OS_LINUX)
    // On Linux, create a .desktop file in ~/.local/share/applications/
    // with MimeType=x-scheme-handler/{protocol}
    // Then run: xdg-mime default bytebridge.desktop x-scheme-handler/{protocol}
    
    QString desktopFile = QString(
        "[Desktop Entry]\n"
        "Name=ByteBridge\n"
        "Exec=%1 %u\n"
        "Type=Application\n"
        "Terminal=false\n"
        "MimeType=x-scheme-handler/%2;\n"
    ).arg(QCoreApplication::applicationFilePath(), protocol);
    
    qDebug() << "Linux URL protocol registration";
    return true;
    
#else
    qWarning() << "URL protocol registration not implemented for this platform";
    return false;
#endif
}

bool DeepLink::unregisterProtocol(const QString &protocol)
{
    qDebug() << "Unregistering URL protocol:" << protocol;
    
#ifdef Q_OS_WIN
    // Remove registry entries
    // HKEY_CURRENT_USER\Software\Classes\{protocol}
    return true;
    
#elif defined(Q_OS_LINUX)
    // Remove .desktop file and xdg-mime association
    return true;
    
#else
    // macOS: Can't easily unregister, handled by system
    return true;
#endif
}

void DeepLink::handleUrl(const QString &url)
{
    qDebug() << "Deep link received:" << url;
    emit deepLinkReceived(url);
}

} // namespace ByteBridge
