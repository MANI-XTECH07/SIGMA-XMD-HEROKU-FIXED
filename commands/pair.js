const { sleep } = require('../lib/myfunc');

async function pairCommand(sock, chatId, message, q) {
    try {
        if (!q) {
            return await sock.sendMessage(chatId, {
                text: "Please provide valid WhatsApp number\nExample: .pair 97798xxxxxxxx",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363411061065067@newsletter',
                        newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                        serverMessageId: -1
                    }
                }
            });
        }

        const numbers = q.split(',')
            .map((v) => v.replace(/[^0-9]/g, ''))
            .filter((v) => v.length > 5 && v.length < 20);

        if (numbers.length === 0) {
            return await sock.sendMessage(chatId, {
                text: "Invalid number❌️ Please use the correct format!",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363411061065067@newsletter',
                        newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                        serverMessageId: -1
                    }
                }
            });
        }

        for (const number of numbers) {
            const whatsappID = number + '@s.whatsapp.net';
            const result = await sock.onWhatsApp(whatsappID);

            if (!result[0]?.exists) {
                return await sock.sendMessage(chatId, {
                    text: `That number is not registered on WhatsApp❗️`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363411061065067@newsletter',
                            newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                            serverMessageId: -1
                        }
                    }
                });
            }

            await sock.sendMessage(chatId, {
                text: "Wait a moment for the code",
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363411061065067@newsletter',
                        newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                        serverMessageId: -1
                    }
                }
            });

            try {
                if (sock.authState?.creds?.registered) {
                    throw new Error('BOT_ALREADY_REGISTERED');
                }

                const code = await sock.requestPairingCode(number);
                const formattedCode = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '');

                await sleep(1000);
                await sock.sendMessage(chatId, {
                    text: `Your pairing code: ${formattedCode}`,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363411061065067@newsletter',
                            newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                            serverMessageId: -1
                        }
                    }
                });
            } catch (apiError) {
                console.error('API Error:', apiError);
                const errorMessage = apiError.message === 'BOT_ALREADY_REGISTERED'
                    ? "This multi-device session is already connected. Use the web pairing page only after resetting/logging out the current session."
                    : "Failed to generate pairing code. Check the bot connection and try again.";
                
                await sock.sendMessage(chatId, {
                    text: errorMessage,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363411061065067@newsletter',
                            newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                            serverMessageId: -1
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error(error);
        await sock.sendMessage(chatId, {
            text: "An error occurred. Please try again later.",
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363411061065067@newsletter',
                    newsletterName: 'ꜱɪɢᴍᴀ xᴍᴅ',
                    serverMessageId: -1
                }
            }
        });
    }
}

module.exports = pairCommand;
