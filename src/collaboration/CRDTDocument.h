#pragma once

#include <QObject>
#include <QByteArray>
#include <QString>
#include <QVector>
#include <QMap>
#include <memory>

namespace ByteBridge {

/**
 * Represents a single operation in the CRDT document.
 */
struct CRDTOperation
{
    enum Type {
        Insert,
        Delete
    };
    
    Type type;
    int position;
    QString content;      // For insert
    int length;           // For delete
    quint64 timestamp;
    QString clientId;
};

/**
 * CRDT Document implementation for collaborative text editing.
 * This is a simplified implementation compatible with Yjs protocol.
 * 
 * The document maintains a vector of operations and can merge
 * remote changes with local changes in a conflict-free manner.
 */
class CRDTDocument : public QObject
{
    Q_OBJECT

public:
    explicit CRDTDocument(QObject *parent = nullptr);
    ~CRDTDocument() = default;

    // Document lifecycle
    void initialize(const QString &documentId);
    void reset();
    
    // Local operations (from editor)
    void localInsert(int position, const QString &text);
    void localDelete(int position, int length);
    
    // Get current document content
    QString content() const { return m_content; }
    void setContent(const QString &content);
    
    // Document ID
    QString documentId() const { return m_documentId; }

public slots:
    // Remote operations (from WebSocket)
    void handleRemoteUpdate(const QByteArray &data);

signals:
    // Notify when content changes (for editor sync)
    void contentChanged(const QString &newContent);
    void remoteInsert(int position, const QString &text);
    void remoteDelete(int position, int length);
    
    // Send local changes to WebSocket
    void localUpdateReady(const QByteArray &data);

private:
    // Serialize/deserialize operations
    QByteArray serializeOperation(const CRDTOperation &op) const;
    CRDTOperation deserializeOperation(const QByteArray &data) const;
    
    // Apply operations
    void applyOperation(const CRDTOperation &op);
    
    // Generate unique client ID
    QString generateClientId() const;
    
    QString m_documentId;
    QString m_clientId;
    QString m_content;
    QVector<CRDTOperation> m_operations;
    quint64 m_vectorClock;
};

} // namespace ByteBridge
