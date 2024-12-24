import { App, Editor, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

interface ConverterSetting {
    baseURL: string;
    model: string;
    apiKey: string;
}

const DEFAULT_SETTINGS: ConverterSetting = {
    baseURL: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: 'sk-oeglkabudsbxjlwgmasreoafklxugoupcvbstsusqgkrfpkm',
}

export default class PinyinConverter extends Plugin {
    settings: ConverterSetting;

    async onload() {
        await this.loadSettings();

        // This adds a status bar item to the bottom of the app. Does not work on mobile apps.
        const statusBarItemEl = this.addStatusBarItem();
        statusBarItemEl.setText('Pinyin Converter Ready');

        // This adds a simple command that can be triggered anywhere
        this.addCommand({
            id: 'convert-to-characters-math',
            name: '转换为汉字和mathjax',
            editorCallback: (editor: Editor) => {
                this.convertToCharacters(editor);
            }
        });

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new PinyinConverterSettingTab(this.app, this));
    }

    async convertToCharacters(editor: Editor) {
        const selectedText = editor.getSelection();
        if (!selectedText) {
            new Notice('请先选择要转换的拼音文本', 3000);
            return;
        }

        const loadingNotice = new Notice('正在转换拼音...', 0);

        try {
            const normalizedText = await this.callAPI(selectedText);
            if (normalizedText) {
                editor.replaceSelection(normalizedText);
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

    async callAPI(input: string): Promise<string> {
		
        try {
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
                            content: `将以下拼音转为文字：${input}`
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

    onunload() {

    }

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
            .setDesc('API访问密钥')
            .addText(text => text
                .setPlaceholder('sk-oeglkabudsbxjlwgmasreoafklxugoupcvbstsusqgkrfpkm')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
            }));
    }
}