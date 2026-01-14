#pragma once

#include <QWidget>
#include <QString>
#include <QMap>

// Forward declarations for QScintilla
class QsciScintilla;
class QsciLexer;

namespace ByteBridge {

/**
 * Code editor widget based on QScintilla.
 * Provides syntax highlighting, line numbers, and code editing features.
 * Equivalent to Monaco Editor in the original TypeScript version.
 */
class CodeEditor : public QWidget
{
    Q_OBJECT

public:
    explicit CodeEditor(QWidget *parent = nullptr);
    ~CodeEditor();

    // Text operations
    QString text() const;
    void setText(const QString &text);
    void insertText(int position, const QString &text);
    void removeText(int start, int end);
    
    // Cursor operations
    int cursorPosition() const;
    void setCursorPosition(int position);
    int cursorLine() const;
    int cursorColumn() const;
    void getCursorLineColumn(int &line, int &column) const;
    void setCursorLineColumn(int line, int column);
    
    // Selection operations
    QString selectedText() const;
    void setSelection(int startLine, int startCol, int endLine, int endCol);
    
    // Language/Lexer
    void setLanguage(const QString &language);
    QString currentLanguage() const { return m_currentLanguage; }
    
    // Editing operations
    void undo();
    void redo();
    void cut();
    void copy();
    void paste();
    void selectAll();
    
    // Zoom
    void zoomIn();
    void zoomOut();
    void resetZoom();
    
    // Access to internal editor (for advanced operations)
    QsciScintilla* editor() const { return m_editor; }

signals:
    void textChanged();
    void cursorPositionChanged(int line, int column);
    void selectionChanged();

private slots:
    void onTextChanged();
    void onCursorPositionChanged(int line, int index);

private:
    void setupEditor();
    void setupLexers();
    QsciLexer* getLexerForLanguage(const QString &language);

    QsciScintilla *m_editor;
    QString m_currentLanguage;
    QMap<QString, QsciLexer*> m_lexers;
    int m_baseZoom;
};

} // namespace ByteBridge
