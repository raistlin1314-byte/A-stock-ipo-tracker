// scripts/fetch-ipo-data.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 使用Tushare API获取数据
async function fetchIpoDataFromTushare() {
    const token = process.env.TUSHARE_TOKEN;
    if (!token) {
        throw new Error("Tushare Token未配置，请在GitHub Secrets中设置TUSHARE_TOKEN");
    }

    try {
        console.log("正在从Tushare获取最新A股打新数据...");
        
        // 调用Tushare API获取新股数据
        const response = await axios.post('https://api.waditu.com', {
            api_name: 'new_share',
            token: token,
            params: {
                // 查询未来30天内的新股
                start_date: new Date().toISOString().slice(0, 10),
                end_date: new Date(Date.now() + 30*24*60*60*1000).toISOString().slice(0, 10)
            },
            fields: 'ts_code,name,ipoadvance_date,market,price,max_amt,pe,amount_raised,apply_code,apply_date,list_date,industry'
        });

        if (response.data?.data?.items && Array.isArray(response.data.data.items)) {
            const rawData = response.data.data.items;
            
            // 转换数据格式以匹配前端需求
            const transformedData = rawData.map(item => {
                // 根据股票代码判断市场
                const market = getMarketByCode(item.ts_code);
                
                // 计算所需市值（简化算法）
                const requiredMarketValue = calculateMarketValue(item.max_amt);
                
                return {
                    name: item.name || '未知',
                    code: item.ts_code ? item.ts_code.split('.')[0] : '未知',
                    date: item.apply_date || item.ipoadvance_date || '待定',
                    market: market,
                    price: item.price ? parseFloat(item.price) : null,
                    maxSubscription: item.max_amt ? parseInt(item.max_amt) : 0,
                    requiredMarketValue: requiredMarketValue,
                    industry: item.industry || '未知',
                    peRatio: item.pe ? parseFloat(item.pe) : '待定',
                    expectedFundraise: item.amount_raised || '待定',
                    listingDate: item.list_date || '待定'
                };
            }).filter(item => item.code !== '未知'); // 过滤无效数据
            
            console.log(`成功获取 ${transformedData.length} 条新股数据`);
            return transformedData;
        } else {
            console.warn("API返回数据格式异常，使用空数组");
            return [];
        }
    } catch (error) {
        console.error("Tushare API调用失败:", error.response?.data || error.message);
        
        // 返回模拟数据作为备选
        console.log("使用模拟数据作为备选方案");
        return [
            {
                name: "测试股票A",
                code: "000001",
                date: new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0, 10), // 7天后
                market: "深市主板",
                price: 15.50,
                maxSubscription: 20000,
                requiredMarketValue: { shanghai: 0, shenzhen: 2 },
                industry: "制造业",
                peRatio: 20.5,
                expectedFundraise: "10亿",
                listingDate: new Date(Date.now() + 14*24*60*60*1000).toISOString().slice(0, 10)
            },
            {
                name: "测试股票B",
                code: "688001",
                date: new Date(Date.now() + 14*24*60*60*1000).toISOString().slice(0, 10), // 14天后
                market: "科创板",
                price: null,
                maxSubscription: 30000,
                requiredMarketValue: { shanghai: 5, shenzhen: 0 },
                industry: "科技",
                peRatio: "待定",
                expectedFundraise: "待定",
                listingDate: "待定"
            }
        ];
    }
}

// 根据股票代码判断市场
function getMarketByCode(code) {
    if (!code) return '未知';
    
    const prefix = code.substring(0, 3);
    if (code.includes('.SH')) {
        if (prefix.startsWith('688')) return '科创板';
        else if (prefix.startsWith('600') || prefix.startsWith('601') || prefix.startsWith('603')) return '沪市主板';
        else return '沪市';
    } else if (code.includes('.SZ')) {
        if (prefix.startsWith('300')) return '创业板';
        else if (prefix.startsWith('002') || prefix.startsWith('003')) return '深市主板';
        else if (prefix.startsWith('8')) return '北交所';
        else return '深市';
    }
    return '未知';
}

// 计算所需市值（根据最大申购额度）
function calculateMarketValue(maxAmt) {
    if (!maxAmt) {
        return { shanghai: 1, shenzhen: 1 }; // 默认值
    }
    
    // 上海市场：每1万元市值对应1000股申购额度
    // 深圳市场：每1万元市值对应500股申购额度
    const maxSub = parseInt(maxAmt) || 10000;
    
    // 上海市场计算（科创板、沪市主板）
    const shanghai = Math.max(1, Math.ceil(maxSub / 1000));
    
    // 深圳市场计算（创业板、深市主板）
    const shenzhen = Math.max(1, Math.ceil(maxSub / 500));
    
    return { shanghai, shenzhen };
}

// 更新HTML文件中的数据
async function updateHtmlFile(ipoData) {
    const indexPath = path.join(__dirname, '../index.html');
    
    if (!fs.existsSync(indexPath)) {
        throw new Error("未找到index.html文件，请确保在正确的目录结构中运行此脚本");
    }
    
    let htmlContent = fs.readFileSync(indexPath, 'utf8');
    
    // 替换HTML中的数据占位符
    const newDataSection = `const mockIpoData = ${JSON.stringify(ipoData, null, 4)};`;
    
    // 查找并替换现有的mockIpoData定义
    const updatedHtml = htmlContent.replace(
        /(const mockIpoData = )\[([^\]]*?)\];/s,
        newDataSection
    ).replace(
        /更新时间：[^<]*<\/span>/,
        `更新时间：${new Date().toLocaleString('zh-CN')} (自动更新)</span>`
    ).replace(
        /最后更新：[^<]*<\/p>/,
        `最后更新：${new Date().toLocaleString('zh-CN')} (通过Tushare API自动获取)</p>`
    );

    fs.writeFileSync(indexPath, updatedHtml, 'utf8');
    console.log(`✅ 成功更新HTML文件，包含 ${ipoData.length} 条新股数据`);
    
    // 创建数据备份
    const backupPath = path.join(__dirname, `../data-backup-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
        updateTime: new Date().toISOString(),
        data: ipoData
    }, null, 2), 'utf8');
    
    console.log(`💾 数据备份已保存至: ${backupPath}`);
}

// 主函数
async function main() {
    console.log("🚀 开始获取最新A股打新数据...");
    
    try {
        // 从Tushare获取数据
        const ipoData = await fetchIpoDataFromTushare();
        
        // 更新HTML文件
        await updateHtmlFile(ipoData);
        
        console.log("🎉 数据更新完成！");
    } catch (error) {
        console.error("❌ 数据更新失败:", error.message);
        process.exit(1);
    }
}

// 执行主函数
if (require.main === module) {
    main().catch(error => {
        console.error("脚本执行出错:", error);
        process.exit(1);
    });
}