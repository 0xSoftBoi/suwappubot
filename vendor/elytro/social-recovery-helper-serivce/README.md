# social-recovery-helper-serivce
+ social recovery helper serivce [pay the gas fee, only use in the POC]
+ `Caution`: not the product version.

### **Init**
```bash
npm install
```

### **Build**
```bash
make publish
```

### **Run**
```bash
sudo curl -fsSL https://get.docker.com | sh

sudo docker run -d \
    --name social-recovery-helper \
    -v '/home/ubuntu/social-recovery-helper/config.yaml':'/root/config.yaml' \
    cejay/social-recovery-helper:latest
```
