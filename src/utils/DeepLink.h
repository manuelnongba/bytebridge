#pragma once

#include <QObject>
#include <QString>

namespace ByteBridge {

/**
 * Deep link handler for custom URL protocol (myapp://).
 * Handles registration and receiving of deep link URLs.
 */
class DeepLink : public QObject
{
    Q_OBJECT

public:
    static DeepLink& instance();
    
    // Protocol registration
    static bool registerProtocol(const QString &protocol);
    static bool unregisterProtocol(const QString &protocol);
    
    // Handle incoming URL
    void handleUrl(const QString &url);

signals:
    void deepLinkReceived(const QString &url);

private:
    DeepLink(QObject *parent = nullptr);
    ~DeepLink() = default;
    
    // Prevent copying
    DeepLink(const DeepLink&) = delete;
    DeepLink& operator=(const DeepLink&) = delete;
};

} // namespace ByteBridge
