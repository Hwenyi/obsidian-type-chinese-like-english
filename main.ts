import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface ConverterSetting {
    baseURL: string;
    model: string;
    apiKey: string;
    withContext: boolean;
}

const DEFAULT_SETTINGS: ConverterSetting = {
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: 'sk-oeglkabudsbxjlwgmasreoafklxugoupcvbstsusqgkrfpkm',
    withContext: false
}

export default class PinyinConverter extends Plugin {
    settings: ConverterSetting;

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'convert-to-characters-math',
            name: '转换为汉字和mathjax',
            hotkeys: [{modifiers: ["Alt"], key: 'i'}],
            editorCallback: (editor: Editor) => {
                this.convertToCharacters(editor);
            }
        });

        this.addSettingTab(new PinyinConverterSettingTab(this.app, this));
    }

    async convertToCharacters(editor: Editor) {
        const line = editor.getCursor().line;
        const lineText = editor.getLine(line);
        
        if (!lineText) {
            new Notice('当前行没有文本可转换', 3000);
            return;
        }

        const loadingNotice = new Notice('正在转换拼音...', 0);

        try {
            let context = '';
            if (this.settings.withContext) {
                // 获取整个文档内容
                const fullContent = editor.getValue();
                // 将当前行标记出来
                const lines = fullContent.split('\n');
                lines[line] = `[待转换行] ${lines[line]}`;
                context = lines.join('\n');
            }

            const convertedText = await this.callAPI(lineText, context);
            
            if (convertedText) {
                // 替换当前行内容
                editor.replaceRange('', 
                    { line: line, ch: 0 }, 
                    { line: line, ch: lineText.length }
                );
                editor.setCursor({ line: line, ch: 0 });
                editor.replaceRange(convertedText, { line: line, ch: 0 });
                new Notice('转换完成！', 2000);
            } else {
                throw new Error('API返回的结果为空');
            }
        } catch (error) {
            console.error('Conversion error:', error);
            new Notice(`转换失败: ${error instanceof Error ? error.message : '未知错误'}`, 5000);
        } finally {
            loadingNotice.hide();
        }
    }

    async callAPI(input: string, context = ''): Promise<string> {
        try {
            let prompt = '';
            if (context) {
                prompt = `以下是一段笔记内容，其中标记了[待转换行]的行需要将拼音转换为汉字。请在转换时参考笔记的上下文，以保证转换结果的准确性和连贯性。
                
笔记内容：
${context}

请仅输出转换后的结果，不要包含任何解释或额外文字。`;
            } else {
                prompt = `将以下拼音转为文字：${input}`;
            }

            const response = await fetch(`${this.settings.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.settings.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: this.settings.model,
                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    stream: false,
                    max_tokens: 4096,
                    temperature: 0.5,
                    top_p: 0.7
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(
                    errorData?.error?.message || 
                    `API请求失败 (HTTP ${response.status})`
                );
            }

            const data = await response.json();
            
            if (!data.choices?.[0]?.message?.content) {
                throw new Error('API返回的数据格式不正确');
            }

            // 如果是上下文模式，需要从返回结果中提取出转换后的那一行
            if (context) {
                const convertedLine = data.choices[0].message.content.trim();
                // 确保我们只返回转换后的那一行，而不是整个上下文
                return convertedLine;
            }

            return data.choices[0].message.content;

        } catch (error) {
            console.error('API Error:', error);
            if (error instanceof Error) {
                if (error.message.includes('Failed to fetch')) {
                    throw new Error(`无法连接到API服务器 (${this.settings.baseURL})`);
                }
                throw error;
            }
            throw new Error('调用API时发生未知错误');
        }
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class PinyinConverterSettingTab extends PluginSettingTab {
    plugin: PinyinConverter;

    constructor(app: App, plugin: PinyinConverter) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;

        containerEl.empty();

        containerEl.createEl('h2', {text: '拼音转换设置'});

        new Setting(containerEl)
            .setName('模型')
            .setDesc('用于转换的默认模型')
            .addText(text => text
                .setPlaceholder('Qwen/Qwen2.5-7B-Instruct')
                .setValue(this.plugin.settings.model)
                .onChange(async (value) => {
                    this.plugin.settings.model = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('API地址')
            .setDesc('API服务器地址，例如: https://api.siliconflow.cn/v1 (注意：/v1不能省略)')
            .addText(text => text
                .setPlaceholder('https://api.siliconflow.cn/v1')
                .setValue(this.plugin.settings.baseURL)
                .onChange(async (value) => {
                    this.plugin.settings.baseURL = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('API密钥')
            .setDesc('一般是sk-')
            .addText(text => text
                .setPlaceholder('sk-oeglkabudsbxjlwgmasreoafklxugoupcvbstsusqgkrfpkm')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('是否包含笔记上下文')
            .setDesc('将会消耗稍多的token，以及稍慢的响应时间，但有更好的转换效果')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.withContext)
                .onChange(async (value) => {
                    this.plugin.settings.withContext = value;
                    await this.plugin.saveSettings();
            }));
    }
}