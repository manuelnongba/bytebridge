#pragma once

#include <QObject>
#include <QString>
#include <QFuture>

namespace ByteBridge {

/**
 * AI Bridger for integrating AI suggestions into the editor.
 * Placeholder for future AI/LLM integration (OpenAI, local LLM, etc.)
 */
class AIBridger : public QObject
{
    Q_OBJECT

public:
    explicit AIBridger(QObject *parent = nullptr);
    ~AIBridger() = default;

    // Get AI suggestion for code
    QString getSuggestion(const QString &code);
    
    // Async version
    QFuture<QString> getSuggestionAsync(const QString &code);
    
    // Configuration
    void setApiKey(const QString &key) { m_apiKey = key; }
    void setEndpoint(const QString &endpoint) { m_endpoint = endpoint; }
    void setModel(const QString &model) { m_model = model; }
    
    // Enable/disable
    void setEnabled(bool enabled) { m_enabled = enabled; }
    bool isEnabled() const { return m_enabled; }

signals:
    void suggestionReady(const QString &suggestion);
    void errorOccurred(const QString &error);

private:
    QString m_apiKey;
    QString m_endpoint;
    QString m_model;
    bool m_enabled;
};

} // namespace ByteBridge
