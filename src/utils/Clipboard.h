#pragma once

#include <QString>

namespace ByteBridge {

/**
 * Clipboard utilities for copy/paste operations.
 */
class Clipboard
{
public:
    // Copy text to clipboard
    static bool copy(const QString &text);
    
    // Get text from clipboard
    static QString paste();
    
    // Check if clipboard has text
    static bool hasText();
    
    // Clear clipboard
    static void clear();
};

} // namespace ByteBridge
