#include "CodeEditor.h"

#include <QVBoxLayout>
#include <QFont>
#include <QFontDatabase>

// QScintilla includes
#include <Qsci/qsciscintilla.h>
#include <Qsci/qscilexerpython.h>
#include <Qsci/qscilexerjavascript.h>
#include <Qsci/qscilexercpp.h>
#include <Qsci/qscilexerjava.h>
#include <Qsci/qscilexercsharp.h>
#include <Qsci/qscilexerruby.h>
#include <Qsci/qscilexerhtml.h>
#include <Qsci/qscilexercss.h>
#include <Qsci/qscilexerjson.h>
#include <Qsci/qscilexerxml.h>
#include <Qsci/qscilexeryaml.h>
#include <Qsci/qscilexermarkdown.h>
#include <Qsci/qscilexersql.h>
#include <Qsci/qscilexerbash.h>

namespace ByteBridge {

CodeEditor::CodeEditor(QWidget *parent)
    : QWidget(parent)
    , m_editor(nullptr)
    , m_currentLanguage("javascript")
    , m_baseZoom(0)
{
    setupEditor();
    setupLexers();
}

CodeEditor::~CodeEditor()
{
    // Clean up lexers
    qDeleteAll(m_lexers);
    m_lexers.clear();
}

void CodeEditor::setupEditor()
{
    QVBoxLayout *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    
    m_editor = new QsciScintilla(this);
    layout->addWidget(m_editor);
    
    // Use a good monospace font
    QFont font;
#ifdef Q_OS_MAC
    font = QFont("SF Mono", 13);
    if (!QFontDatabase::hasFamily("SF Mono")) {
        font = QFont("Menlo", 13);
    }
#elif defined(Q_OS_WIN)
    font = QFont("Cascadia Code", 11);
    if (!QFontDatabase::hasFamily("Cascadia Code")) {
        font = QFont("Consolas", 11);
    }
#else
    font = QFont("Ubuntu Mono", 12);
    if (!QFontDatabase::hasFamily("Ubuntu Mono")) {
        font = QFont("Monospace", 11);
    }
#endif
    m_editor->setFont(font);
    
    // Editor appearance - Dark theme (VS Code style)
    m_editor->setMarginsBackgroundColor(QColor("#1e1e1e"));
    m_editor->setMarginsForegroundColor(QColor("#858585"));
    m_editor->setCaretForegroundColor(QColor("#ffffff"));
    m_editor->setCaretLineVisible(true);
    m_editor->setCaretLineBackgroundColor(QColor("#264f78"));
    m_editor->setPaper(QColor("#1e1e1e"));
    m_editor->setColor(QColor("#d4d4d4"));
    
    // Line numbers
    m_editor->setMarginType(0, QsciScintilla::NumberMargin);
    m_editor->setMarginWidth(0, "00000");
    m_editor->setMarginLineNumbers(0, true);
    
    // Folding
    m_editor->setFolding(QsciScintilla::BoxedTreeFoldStyle, 1);
    m_editor->setFoldMarginColors(QColor("#1e1e1e"), QColor("#1e1e1e"));
    
    // Indentation
    m_editor->setIndentationGuides(true);
    m_editor->setIndentationsUseTabs(false);
    m_editor->setTabWidth(4);
    m_editor->setAutoIndent(true);
    m_editor->setBackspaceUnindents(true);
    
    // Brace matching
    m_editor->setBraceMatching(QsciScintilla::SloppyBraceMatch);
    m_editor->setMatchedBraceBackgroundColor(QColor("#515a6b"));
    m_editor->setMatchedBraceForegroundColor(QColor("#ffd700"));
    m_editor->setUnmatchedBraceBackgroundColor(QColor("#ff0000"));
    
    // Auto-completion
    m_editor->setAutoCompletionSource(QsciScintilla::AcsAll);
    m_editor->setAutoCompletionThreshold(2);
    m_editor->setAutoCompletionCaseSensitivity(false);
    m_editor->setAutoCompletionReplaceWord(true);
    
    // Edge line at 80 characters
    m_editor->setEdgeMode(QsciScintilla::EdgeLine);
    m_editor->setEdgeColumn(80);
    m_editor->setEdgeColor(QColor("#3c3c3c"));
    
    // Selection colors
    m_editor->setSelectionBackgroundColor(QColor("#264f78"));
    m_editor->setSelectionForegroundColor(QColor("#ffffff"));
    
    // Whitespace
    m_editor->setWhitespaceVisibility(QsciScintilla::WsInvisible);
    
    // EOL
    m_editor->setEolMode(QsciScintilla::EolUnix);
    m_editor->setEolVisibility(false);
    
    // Connect signals
    connect(m_editor, &QsciScintilla::textChanged, 
            this, &CodeEditor::onTextChanged);
    connect(m_editor, &QsciScintilla::cursorPositionChanged,
            this, &CodeEditor::onCursorPositionChanged);
    connect(m_editor, &QsciScintilla::selectionChanged,
            this, &CodeEditor::selectionChanged);
}

void CodeEditor::setupLexers()
{
    // Create lexers for various languages
    // They will be styled with dark theme colors
    
    auto styleLexer = [this](QsciLexer *lexer) {
        lexer->setDefaultFont(m_editor->font());
        lexer->setDefaultPaper(QColor("#1e1e1e"));
        lexer->setDefaultColor(QColor("#d4d4d4"));
    };
    
    // JavaScript/TypeScript
    auto *jsLexer = new QsciLexerJavaScript(this);
    styleLexer(jsLexer);
    jsLexer->setColor(QColor("#569cd6"), QsciLexerJavaScript::Keyword);        // keywords blue
    jsLexer->setColor(QColor("#6a9955"), QsciLexerJavaScript::Comment);        // comments green
    jsLexer->setColor(QColor("#6a9955"), QsciLexerJavaScript::CommentLine);
    jsLexer->setColor(QColor("#ce9178"), QsciLexerJavaScript::DoubleQuotedString);  // strings orange
    jsLexer->setColor(QColor("#ce9178"), QsciLexerJavaScript::SingleQuotedString);
    jsLexer->setColor(QColor("#b5cea8"), QsciLexerJavaScript::Number);         // numbers light green
    jsLexer->setColor(QColor("#4ec9b0"), QsciLexerJavaScript::GlobalClass);    // classes teal
    m_lexers["javascript"] = jsLexer;
    m_lexers["typescript"] = jsLexer;
    
    // Python
    auto *pyLexer = new QsciLexerPython(this);
    styleLexer(pyLexer);
    pyLexer->setColor(QColor("#569cd6"), QsciLexerPython::Keyword);
    pyLexer->setColor(QColor("#6a9955"), QsciLexerPython::Comment);
    pyLexer->setColor(QColor("#ce9178"), QsciLexerPython::DoubleQuotedString);
    pyLexer->setColor(QColor("#ce9178"), QsciLexerPython::SingleQuotedString);
    pyLexer->setColor(QColor("#b5cea8"), QsciLexerPython::Number);
    pyLexer->setColor(QColor("#4ec9b0"), QsciLexerPython::ClassName);
    pyLexer->setColor(QColor("#dcdcaa"), QsciLexerPython::FunctionMethodName);
    pyLexer->setColor(QColor("#c586c0"), QsciLexerPython::Decorator);
    m_lexers["python"] = pyLexer;
    
    // C/C++
    auto *cppLexer = new QsciLexerCPP(this);
    styleLexer(cppLexer);
    cppLexer->setColor(QColor("#569cd6"), QsciLexerCPP::Keyword);
    cppLexer->setColor(QColor("#6a9955"), QsciLexerCPP::Comment);
    cppLexer->setColor(QColor("#6a9955"), QsciLexerCPP::CommentLine);
    cppLexer->setColor(QColor("#ce9178"), QsciLexerCPP::DoubleQuotedString);
    cppLexer->setColor(QColor("#b5cea8"), QsciLexerCPP::Number);
    cppLexer->setColor(QColor("#c586c0"), QsciLexerCPP::PreProcessor);
    m_lexers["c++"] = cppLexer;
    m_lexers["c"] = cppLexer;
    m_lexers["cpp"] = cppLexer;
    
    // Java
    auto *javaLexer = new QsciLexerJava(this);
    styleLexer(javaLexer);
    m_lexers["java"] = javaLexer;
    
    // C#
    auto *csLexer = new QsciLexerCSharp(this);
    styleLexer(csLexer);
    m_lexers["c#"] = csLexer;
    m_lexers["csharp"] = csLexer;
    
    // Ruby
    auto *rubyLexer = new QsciLexerRuby(this);
    styleLexer(rubyLexer);
    m_lexers["ruby"] = rubyLexer;
    
    // HTML
    auto *htmlLexer = new QsciLexerHTML(this);
    styleLexer(htmlLexer);
    m_lexers["html"] = htmlLexer;
    
    // CSS/SCSS
    auto *cssLexer = new QsciLexerCSS(this);
    styleLexer(cssLexer);
    m_lexers["css"] = cssLexer;
    m_lexers["scss"] = cssLexer;
    
    // JSON
    auto *jsonLexer = new QsciLexerJSON(this);
    styleLexer(jsonLexer);
    m_lexers["json"] = jsonLexer;
    
    // XML
    auto *xmlLexer = new QsciLexerXML(this);
    styleLexer(xmlLexer);
    m_lexers["xml"] = xmlLexer;
    
    // YAML
    auto *yamlLexer = new QsciLexerYAML(this);
    styleLexer(yamlLexer);
    m_lexers["yaml"] = yamlLexer;
    
    // Markdown
    auto *mdLexer = new QsciLexerMarkdown(this);
    styleLexer(mdLexer);
    m_lexers["markdown"] = mdLexer;
    
    // SQL
    auto *sqlLexer = new QsciLexerSQL(this);
    styleLexer(sqlLexer);
    m_lexers["sql"] = sqlLexer;
    
    // Shell/Bash
    auto *bashLexer = new QsciLexerBash(this);
    styleLexer(bashLexer);
    m_lexers["shell"] = bashLexer;
    m_lexers["bash"] = bashLexer;
    m_lexers["powershell"] = bashLexer;  // Use bash lexer for PowerShell as fallback
    
    // Set default lexer
    setLanguage("javascript");
}

QsciLexer* CodeEditor::getLexerForLanguage(const QString &language)
{
    QString lang = language.toLower();
    if (m_lexers.contains(lang)) {
        return m_lexers[lang];
    }
    return nullptr;  // Plain text
}

void CodeEditor::setLanguage(const QString &language)
{
    m_currentLanguage = language.toLower();
    QsciLexer *lexer = getLexerForLanguage(m_currentLanguage);
    m_editor->setLexer(lexer);
    
    // Reapply font after setting lexer
    if (lexer) {
        lexer->setFont(m_editor->font());
    }
}

QString CodeEditor::text() const
{
    return m_editor->text();
}

void CodeEditor::setText(const QString &text)
{
    m_editor->setText(text);
}

void CodeEditor::insertText(int position, const QString &text)
{
    m_editor->SendScintilla(QsciScintilla::SCI_INSERTTEXT, position, text.toUtf8().constData());
}

void CodeEditor::removeText(int start, int end)
{
    m_editor->SendScintilla(QsciScintilla::SCI_DELETERANGE, start, end - start);
}

int CodeEditor::cursorPosition() const
{
    return m_editor->SendScintilla(QsciScintilla::SCI_GETCURRENTPOS);
}

void CodeEditor::setCursorPosition(int position)
{
    m_editor->SendScintilla(QsciScintilla::SCI_GOTOPOS, position);
}

int CodeEditor::cursorLine() const
{
    int line, column;
    m_editor->getCursorPosition(&line, &column);
    return line + 1;  // 1-based
}

int CodeEditor::cursorColumn() const
{
    int line, column;
    m_editor->getCursorPosition(&line, &column);
    return column + 1;  // 1-based
}

void CodeEditor::getCursorLineColumn(int &line, int &column) const
{
    int l, c;
    m_editor->getCursorPosition(&l, &c);
    line = l + 1;    // 1-based
    column = c + 1;  // 1-based
}

void CodeEditor::setCursorLineColumn(int line, int column)
{
    m_editor->setCursorPosition(line - 1, column - 1);  // Convert to 0-based
}

QString CodeEditor::selectedText() const
{
    return m_editor->selectedText();
}

void CodeEditor::setSelection(int startLine, int startCol, int endLine, int endCol)
{
    m_editor->setSelection(startLine - 1, startCol - 1, endLine - 1, endCol - 1);
}

void CodeEditor::undo()
{
    m_editor->undo();
}

void CodeEditor::redo()
{
    m_editor->redo();
}

void CodeEditor::cut()
{
    m_editor->cut();
}

void CodeEditor::copy()
{
    m_editor->copy();
}

void CodeEditor::paste()
{
    m_editor->paste();
}

void CodeEditor::selectAll()
{
    m_editor->selectAll();
}

void CodeEditor::zoomIn()
{
    m_editor->zoomIn();
}

void CodeEditor::zoomOut()
{
    m_editor->zoomOut();
}

void CodeEditor::resetZoom()
{
    m_editor->zoomTo(m_baseZoom);
}

void CodeEditor::onTextChanged()
{
    emit textChanged();
}

void CodeEditor::onCursorPositionChanged(int line, int index)
{
    emit cursorPositionChanged(line + 1, index + 1);  // 1-based
}

} // namespace ByteBridge
