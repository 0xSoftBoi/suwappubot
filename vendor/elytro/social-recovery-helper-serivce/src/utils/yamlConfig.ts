/*
 * @Description: 
 * @Version: 1.0
 * @Autor: z.cejay@gmail.com
 * @Date: 2022-08-08 21:58:13
 * @LastEditors: cejay
 * @LastEditTime: 2022-09-30 18:27:41
 */
import YAML from 'yaml'
import fs from 'fs';
import Web3 from 'web3';

export class YamlConfig {

    private static instance: YamlConfig;

    public infuraProvider = '';

    public entryPoint = '';

    public sponsors = [

    ];


    private constructor() {
        let yamlPath = '';
        if (fs.existsSync('/root/config.yaml')) {
            yamlPath = '/root/config.yaml'
        } else {
            console.log('no config file specified, use default config file: ../config.yaml');
            yamlPath = 'config.yaml';//console.log('current path: ' + process.cwd());
        }
        const yamlContent = fs.readFileSync(yamlPath, 'utf8');
        const yamlObj = YAML.parse(yamlContent);


        // check config

        if (!yamlObj.entryPoint) throw new Error('entryPoint config not found');
        if (typeof yamlObj.entryPoint !== 'string') throw new Error('entryPoint config should be string');
        this.entryPoint = (yamlObj.entryPoint as string).toLowerCase();

        if (!yamlObj.infuraProvider) throw new Error('infuraProvider config not found');
        if (typeof yamlObj.infuraProvider !== 'string') throw new Error('infuraProvider config should be string');
        this.infuraProvider = yamlObj.infuraProvider;

        if (!yamlObj.sponsors) throw new Error('sponsors config not found');
        if (!Array.isArray(yamlObj.sponsors)) throw new Error('sponsors config should be array');
        this.sponsors = yamlObj.sponsors;
        // check address
        const _web3 = new Web3();
        if (!_web3.utils.isAddress(this.entryPoint)) {
            throw new Error('entryPoint address is not valid');
        }

        const _bundlerSet: Set<string> | undefined = new Set<string>();
        for (let index = 0; index < this.sponsors.length; index++) {
            const pk = this.sponsors[index];
            if (_bundlerSet.has(pk)) {
                throw new Error('privateKeys not unique');
            }
            _bundlerSet.add(pk);
            try {
                _web3.eth.accounts.privateKeyToAccount(pk);
            } catch (error) {
                throw new Error('privateKeys[' + index + '] not valid');
            }
        }

    }

    public static getInstance() {
        if (!YamlConfig.instance) {
            YamlConfig.instance = new YamlConfig();
        }
        return YamlConfig.instance;
    }

}