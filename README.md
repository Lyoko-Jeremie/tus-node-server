# tus-node-server-ts

tus is a new open protocol for resumable uploads built on HTTP. This is the [tus protocol 1.0.0](http://tus.io/protocols/resumable-upload.html) node.js server implementation.

> :warning: **Attention:** We currently lack the resources to properly maintain tus-node-server. This has the unfortunate consequence that this project is in rather bad condition (out-dated dependencies, no tests for the S3 storage, no resumable uploads for the GCS storage etc). If you want to help us with tus-node-server, we are more than happy to assist you and welcome new contributors. In the meantime, we can recommend [tusd](https://github.com/tus/tusd) as a reliable and production-tested tus server. Of course, you can use tus-node-server if it serves your purpose.

## Installation

```bash
$ npm install tus-node-server-ts
```

---

## For Typescript User

This lib are translate from Javascript to Typescript for the [origin lib](https://github.com/tus/tus-node-server) by myself. 

Because of my use case. I need use MongoDB(GridFS) in NodeJs.
But the [origin lib](https://github.com/tus/tus-node-server) long-term disrepair without maintenance and no Types for Typescript User.
So I folk this to maintenance it for this use case.

I only test and fixed the Main Part and the MongoDB(GridFS) Component Part. Other Part no maintenance at this times. and the unit test not translate this time.


[Those example codes on README-OLD.md](./README-OLD.md) are come from origin project. They should still work for Javascript user.

---

If you want a workable example for Typescript. Or you want see whats new feature i added to it.

Please see [this](https://github.com/Lyoko-Jeremie/TestTus) .

**Push Request always Welcome !**

---
